import {createHash} from 'node:crypto';
import {prepareFullSupplierRequest} from './guarded-supplier-strict.mjs';

// Provisional 07.10 company card is passed at runtime, NOT stored in this public repository.
// Only the historical fingerprint is pinned. No Gmail send or approval issued here.
export const HISTORICAL_CARD_20261007_SHA256='e514f4ac6a6c40e62d96a09f247f0ce9f531ff030c525ad6be9fe7ab71fa1565';
export const HISTORICAL_CARD_FIELDS=Object.freeze([
 'legalName','inn','kpp','ogrn','legalAddress','bankAccount','bankName','bik','correspondentAccount'
]);
const deny=code=>{const err=Error(code);err.code=code;throw err;};
const normalizeAddress=x=>typeof x==='string'&&/^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/.test(x.trim())?x.trim().toLowerCase():'';
const canon=x=>typeof x==='string'?x.normalize('NFC').replace(/\s+/gu,' ').trim():'';
const sha=x=>createHash('sha256').update(x).digest('hex');

/** Returns only a read-only preview; never grants an email-sending capability. */
export async function preview6217SelfTest({loadOrder,provisionalCard,ownEmail,expectedCardHash=HISTORICAL_CARD_20261007_SHA256}) {
 if(typeof loadOrder!=='function')deny('VERIFIED_LIVE_ORDER_READER_REQUIRED');
 if(!normalizeAddress(ownEmail))deny('VERIFIED_ACCOUNT_REQUIRED');
 if(!provisionalCard||typeof provisionalCard!=='object'||Array.isArray(provisionalCard)||
    Object.keys(provisionalCard).length!==HISTORICAL_CARD_FIELDS.length||
    !HISTORICAL_CARD_FIELDS.every(k=>typeof provisionalCard[k]==='string'&&canon(provisionalCard[k])))
   deny('HISTORICAL_CARD_INCOMPLETE');
 const raw={};for(const k of HISTORICAL_CARD_FIELDS)raw[k]=canon(provisionalCard[k]);
 const actualHash=sha(JSON.stringify(raw));
 if(!/^[a-f0-9]{64}$/.test(expectedCardHash)||actualHash!==expectedCardHash)
   deny('HISTORICAL_CARD_MISMATCH');
 const order=await loadOrder('6217');
 if(order?.isVerified!==true||order.orderId!=='6217'||!String(order.sourceId||'').startsWith('SHEETS_REGISTRY_AND_ORDER_6217_SHA256_')||
    !Array.isArray(order.positions)||order.positions.length!==10)deny('LIVE_ORDER_NOT_VERIFIED');
 const to=normalizeAddress(ownEmail);
 const company={...raw,isVerified:true,verifiedSource:'SELF_TEST_ONLY:HISTORICAL_AVIOR_CARD_2026-10-07:CONDITIONAL_2026-10-14'};
 const intent={orderId:'6217',userMessageId:'PREVIEW_ONLY_NO_APPROVAL',to,
   positions:order.positions.map(p=>({...p})),paymentTerms:'Отсрочка 30 дней — при согласовании',
   deliveryTerms:'Срок и стоимость доставки уточнить',requestedVat:'НДС с указанием ставки',
   deliveryAddress:order.deliveryAddress,requiredAttachments:[]};
 const supplier={isVerified:true,supplierId:'OWNER_SELF_TEST_ONLY',authorizedEmails:[to]};
 const draft=prepareFullSupplierRequest({intent,order,company,supplier,attachments:[]});
 if(draft.message.to.length!==1||draft.message.to[0]!==to||draft.message.attachments.length||
    draft.provenance.orderId!=='6217')deny('SELFTEST_PREVIEW_UNSAFE');
 return {status:'PREVIEW_ONLY',isSendable:false,
  reason:'EXPLICIT_ONE_TIME_APPROVAL_AND_GMAIL_SEND_ROUTE_NOT_ENABLED',
  orderId:'6217',positions:order.positions.length,companyCardStatus:'HISTORICAL_CONDITIONAL_SELF_TEST_ONLY',
  companyFieldsMatched:HISTORICAL_CARD_FIELDS.length,sourceFingerprint:order.sourceFingerprint,
  draftFingerprint:draft.fingerprint,recipient:to,subject:draft.message.subject,
  bodyLength:draft.message.body.length,requiredAttachments:0,emailsSent:0};
}