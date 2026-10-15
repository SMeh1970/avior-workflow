import {preview6217SelfTest,HISTORICAL_CARD_20261007_SHA256} from './selftest-preview-6217.mjs';
import {prepareFullSupplierRequest} from './guarded-supplier-strict.mjs';
import {conditionalCardForSelfTest,CONDITIONAL_CARD_REFERENCE,CONDITIONAL_CARD_ACKNOWLEDGEMENT} from './conditional-company-card.mjs';
import {dispatchOnce} from './dispatch-once.mjs';

const fail = code => {const e = Error(code);e.code=code;throw e;};
const OWN_ORDER = '6217';
const validId = s => typeof s==='string' && /^[A-Za-z0-9_-]{8,128}$/.test(s);

/**
 * Build from freshly loaded fixed Sheets sources. No caller-supplied order,
 * recipient, positions, attachments, payment terms or message body are trusted.
 * The historical card hash is PINNED in the live route, and is for SELF_TEST only.
 */
export async function prepareSelfTest6217({
  loadOrder, provisionalCard, ownEmail, userMessageId,
  expectedCardHash=HISTORICAL_CARD_20261007_SHA256
}) {
  if(!validId(userMessageId)) fail('USER_MESSAGE_ID_INVALID');
  const preview=await preview6217SelfTest({
    loadOrder,provisionalCard,ownEmail,expectedCardHash
  });
  const order=await loadOrder(OWN_ORDER);
  if(order?.sourceFingerprint!==preview.sourceFingerprint || order?.positions?.length!==10)
    fail('ORDER_CHANGED_DURING_PREPARATION');
  const to=preview.recipient;
  const intent={
    orderId:OWN_ORDER,userMessageId,to,
    positions:order.positions.map(p=>({...p})),
    paymentTerms:'Отсрочка 30 дней — при согласовании',
    deliveryTerms:'Срок и стоимость доставки уточнить',
    requestedVat:'НДС с указанием ставки',
    deliveryAddress:order.deliveryAddress,
    requiredAttachments:[]
  };
  const rawCompany={
    ...provisionalCard,isVerified:false,status:'PROVISIONAL',
    sourceReference:CONDITIONAL_CARD_REFERENCE
  };
  const company=conditionalCardForSelfTest({
    historical:rawCompany,mode:'SELF_TEST',recipient:to,ownAddress:to,
    acknowledgement:CONDITIONAL_CARD_ACKNOWLEDGEMENT
  });
  const supplier={isVerified:true,supplierId:'OWNER_SELF_TEST_ONLY',authorizedEmails:[to]};
  const plan=prepareFullSupplierRequest({intent,order,company,supplier,attachments:[]});
  if(plan.message.to.length!==1||plan.message.to[0]!==to||
    plan.message.cc.length||plan.message.bcc.length||plan.message.attachments.length)
    fail('SELF_TEST_SCOPE_VIOLATION');
  return {intent,plan,rawCompany,supplier,order,preview};
}

/**
 * Only a separately signed, unexpired receipt can authorize this self-send.
 * No receipt can be minted by the MCP tool or by this module.
 * All real data are reloaded in dispatchOnce immediately before the DB claim.
 */
export async function dispatchSelfTest6217({
  loadOrder,provisionalCard,ownEmail,userMessageId,approvalReceipt,
  store,transport,approvalSecret,enabled=false,attachments=[],
  expectedCardHash=HISTORICAL_CARD_20261007_SHA256
}) {
  if(enabled!==true) fail('GMAIL_DISPATCH_DISABLED');
  if(!Array.isArray(attachments)||attachments.length) fail('SELF_TEST_ATTACHMENTS_NOT_ALLOWED');
  const prepared=await prepareSelfTest6217({
    loadOrder,provisionalCard,ownEmail,userMessageId,expectedCardHash
  });
  const {intent,plan,rawCompany,supplier}=prepared;
  return dispatchOnce({
    mode:'SELF_TEST',enabled:true,intent,
    approval:{
      confirmed:true,userMessageId,recipient:plan.message.to[0],
      fingerprint:plan.fingerprint,receipt:approvalReceipt,
      conditionalCompanyCardAcknowledgement:CONDITIONAL_CARD_ACKNOWLEDGEMENT
    },
    loadOrder,loadCompany:async()=>rawCompany,loadSupplier:async()=>supplier,
    attachments:[],store,transport,ownAddress:ownEmail,approvalSecret
  });
}
