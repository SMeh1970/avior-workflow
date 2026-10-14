import { createHash } from 'node:crypto';
import { prepareFullSupplierRequest } from './guarded-supplier-strict.mjs';
import { verifyApprovalReceipt } from './approval-receipt.mjs';
import { conditionalCardForSelfTest } from './conditional-company-card.mjs';

const deny = code => { const e = new Error(code); e.code = code; throw e; };
const normalize = value => String(value || '').trim().toLowerCase();
const sha256 = input => createHash('sha256').update(input).digest('hex');

/**
 * The production path MUST supply live verified source adapters. The client may not
 * supply source verification booleans as a substitute for loading source data.
 * The key is intentionally independent of the proposal fingerprint: changing the
 * content never releases a consumed operation. A new business instruction is needed.
 *
 * At most one ATTEMPT, not guaranteed delivery. In-flight/ambiguous outcomes are
 * irreversibly blocked from automatic retry until independently reconciled.
 */
export async function dispatchOnce({
  intent, approval, loadOrder, loadCompany, loadSupplier, attachments = [],
  store, transport, ownAddress, approvalSecret, enabled = false, mode = 'SELF_TEST'
}) {
  if (!enabled) deny('GMAIL_DISPATCH_DISABLED');
  if (mode !== 'SELF_TEST') deny('SUPPLIER_DISPATCH_NOT_IMPLEMENTED');
  if (typeof loadOrder !== 'function' || typeof loadCompany !== 'function' ||
      typeof loadSupplier !== 'function' || typeof store?.claim !== 'function' ||
      typeof store?.finish !== 'function' || typeof transport?.send !== 'function' ||
      typeof transport?.readSent !== 'function') deny('VERIFIED_ADAPTER_MISSING');
  if (typeof ownAddress !== 'string' || normalize(intent?.to) !== normalize(ownAddress) ||
      intent?.cc?.length || intent?.bcc?.length) deny('SELF_ADDRESS_ONLY');

  const [order, rawCompany, supplier] = await Promise.all([
    loadOrder(intent.orderId), loadCompany(), loadSupplier(intent.to)
  ]);
  // User's conditional 14 Oct statement is NOT general supplier authorization.
  // Only an independently signed self-send approval can reach Gmail afterwards.
  const company = rawCompany?.status==='PROVISIONAL' ? conditionalCardForSelfTest({
    historical:rawCompany,mode,recipient:intent.to,ownAddress,
    acknowledgement:approval?.conditionalCompanyCardAcknowledgement
  }) : rawCompany;
  // Fresh, complete full order is mandatory. No partial orders in this path.
  const plan = prepareFullSupplierRequest({ intent, order, company, supplier, attachments });
  if (plan.message.to.length !== 1 || normalize(plan.message.to[0]) !== normalize(ownAddress))
    deny('SELF_ADDRESS_ONLY');
  if (plan.message.attachments.length !== 0 || attachments.length !== 0)
    deny('SELF_TEST_ATTACHMENTS_NOT_ALLOWED');
  if (approval?.confirmed !== true || approval?.userMessageId !== intent.userMessageId ||
      approval?.fingerprint !== plan.fingerprint || approval?.recipient !== normalize(ownAddress))
    deny('APPROVAL_REQUIRED_OR_STALE');
  verifyApprovalReceipt(approval.receipt, {orderId:String(order.orderId),recipient:normalize(ownAddress),
    userMessageId:intent.userMessageId,fingerprint:plan.fingerprint}, approvalSecret);

  const operationKey = sha256(JSON.stringify({
    v: 1, mode, orderId: String(order.orderId),
    userMessageId: intent.userMessageId, recipient: normalize(ownAddress)
  }));
  const meta = {operationKey, fingerprint: plan.fingerprint, orderId: String(order.orderId),
    recipient: normalize(ownAddress), sourceId: order.sourceId};

  // The DB must atomically INSERT ... ON CONFLICT DO NOTHING. A duplicate,
  // store outage or ambiguous store response MUST NOT call the Gmail API.
  const claimed = await store.claim(meta);
  if (claimed !== true) return {status: 'BLOCKED_ALREADY_CLAIMED', operationKey, emailsSent: 0};
  let gmailId = null;
  let state = 'UNKNOWN';
  let reason = 'SEND_RESULT_UNKNOWN';
  try {
    const sent = await transport.send(plan.message);
    if (!sent?.messageId) deny('SEND_RESULT_UNKNOWN');
    gmailId = sent.messageId;
    state = 'SENT_BUT_UNVERIFIED';
    reason = 'SENT_READBACK_PENDING';
    // Record the message id BEFORE readback to permit manual reconciliation.
    await store.finish({operationKey, state, gmailId, reason});
    const actual = await transport.readSent(gmailId);
    const normalizeBody = s => String(s || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    if (actual?.messageId !== gmailId ||
        JSON.stringify(actual.to?.map(normalize)) !== JSON.stringify(plan.message.to) ||
        (actual.cc || []).length || (actual.bcc || []).length ||
        actual.subject !== plan.message.subject ||
        normalizeBody(actual.body) !== normalizeBody(plan.message.body) ||
        JSON.stringify(actual.attachments || []) !== JSON.stringify(plan.message.attachments))
      deny('SENT_COPY_DIFFERS');
    state = 'VERIFIED';
    reason = null;
    await store.finish({operationKey, state, gmailId, reason});
    return {status: 'VERIFIED', operationKey, gmailId, fingerprint: plan.fingerprint};
  } catch (e) {
    // Even if Gmail throws, its request might have succeeded. Never retry it.
    if (gmailId) {state = 'SENT_BUT_UNVERIFIED'; reason = e.code || 'READBACK_FAILED';}
    else {state = 'UNKNOWN'; reason = e.code || 'SEND_RESULT_UNKNOWN';}
    try { await store.finish({operationKey, state, gmailId, reason}); }
    catch { reason = 'STORE_UPDATE_FAILED_AFTER_CLAIM'; }
    return {status: state, operationKey, gmailId, reason, automaticRetryAllowed: false};
  }
}