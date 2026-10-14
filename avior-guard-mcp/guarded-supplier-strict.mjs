import {prepareSupplierRequest, executeApprovedSupplierRequest} from './guarded-supplier-request.mjs';

const reject = (code) => {const e = new Error(code); e.code = code; throw e;};
const signature = (p) => [p.number, p.name.normalize('NFC').replace(/\s+/gu,' ').trim(),p.unit.normalize('NFC').replace(/\s+/gu,' ').trim(),p.quantity].join('\u001f');

/** Full-order only: explicitly authorized partial inquiries need a separate workflow. */
export function verifyFullOrderSelection(intent, order) {
  if (!order?.isVerified || !order?.sourceId || !Array.isArray(order?.positions) ||
      !intent?.orderId || String(intent.orderId)!==String(order.orderId) ||
      !Array.isArray(intent.positions) || !intent.positions.length) reject('ORDER_SOURCE_UNVERIFIED');
  const expected = order.positions.map(signature).sort();
  const actual = intent.positions.map(signature).sort();
  if (expected.length !== new Set(expected).size || actual.length !== new Set(actual).size ||
      JSON.stringify(expected)!==JSON.stringify(actual)) reject('FULL_ORDER_SELECTION_MISMATCH');
  return true;
}

/** Compare a user-constructed candidate against deterministic output before dispatch. */
export function verifyCandidate(candidate, expected) {
  if (!candidate || !expected || JSON.stringify({
      to:candidate.to,cc:candidate.cc||[],bcc:candidate.bcc||[],subject:candidate.subject,
      body:candidate.body,attachments:candidate.attachments||[]}) !== JSON.stringify(expected))
    reject('OUTBOUND_CANDIDATE_MISMATCH');
  return true;
}

export function prepareFullSupplierRequest(input) {
  verifyFullOrderSelection(input.intent,input.order);
  return prepareSupplierRequest(input);
}

/** Enforces full selection again against freshly loaded order right before dispatch. */
export async function executeApprovedFullSupplierRequest(input) {
  if(typeof input?.loadOrder!=='function')reject('ORDER_LOADER_MISSING');
  return executeApprovedSupplierRequest({ ...input, loadOrder: async(id)=>{
    const fresh = await input.loadOrder(id);
    verifyFullOrderSelection(input.intent,fresh);
    return fresh;
  }});
}