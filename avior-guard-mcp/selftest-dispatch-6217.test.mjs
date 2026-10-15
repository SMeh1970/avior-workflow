import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {prepareSelfTest6217,dispatchSelfTest6217} from './selftest-dispatch-6217.mjs';
import {issueApprovalReceipt} from './approval-receipt.mjs';
import {HISTORICAL_CARD_FIELDS} from './selftest-preview-6217.mjs';

const own='owner@example.org';
const secret='non-production-unit-test-signing-secret-1234567890';
const userMessageId='OWNER_APPROVAL_TEST_6217';
const raw={
 legalName:'Общество с ограниченной ответственностью «ТЕСТ»',inn:'1'.repeat(10),
 kpp:'2'.repeat(9),ogrn:'3'.repeat(13),legalAddress:'Тестовый адрес',
 bankAccount:'4'.repeat(20),bankName:'Тестовый банк',bik:'5'.repeat(9),
 correspondentAccount:'6'.repeat(20)
};
const card=Object.fromEntries(HISTORICAL_CARD_FIELDS.map(k=>[k,raw[k]]));
const expectedCardHash=createHash('sha256').update(JSON.stringify(card)).digest('hex');
const positions=Array.from({length:10},(_,i)=>({number:21212+i,name:'Товар '+(i+1),quantity:i+1,unit:'шт'}));
const order={isVerified:true,orderId:'6217',sourceFingerprint:'source-digest-6217',
 sourceId:'SHEETS_REGISTRY_AND_ORDER_6217_SHA256_source-digest-6217',
 positions,deliveryAddress:'Тестовый адрес доставки'};
const reader=async()=>structuredClone(order);
function memoryStore(){
 const map=new Map();
 return {map,
  async claim(m){if(map.has(m.operationKey))return false;map.set(m.operationKey,{...m,state:'CLAIMED'});return true;},
  async finish(x){const row=map.get(x.operationKey);if(!row)throw Error('NOT_CLAIMED');Object.assign(row,x);return true;}
 };
}
function simulatedGmail(){
 let sent=0,record;
 return {get sends(){return sent;},
  async send(message){sent++;record=message;return {messageId:'MOCK_SENT_001'};},
  async readSent(messageId){return {...record,messageId};}
 };
}
const common=()=>({loadOrder:reader,provisionalCard:card,ownEmail:own,userMessageId,expectedCardHash});
async function approved(overrides={}){
 const base={...common(),...overrides};
 const preview=await prepareSelfTest6217(base);
 const approvalReceipt=issueApprovalReceipt({
  orderId:'6217',recipient:own,userMessageId,
  fingerprint:preview.plan.fingerprint,mode:'SELF_TEST'
 },secret);
 return {...base,approvalReceipt,store:memoryStore(),transport:simulatedGmail(),
  enabled:true,approvalSecret:secret};
}
test('live source and historical hash yield a full ten-item deterministic mail preview',async()=>{
 const {plan}=await prepareSelfTest6217(common());
 assert.equal(plan.message.to[0],own);
 assert.equal(plan.message.attachments.length,0);
 assert.equal(plan.message.cc.length,0);
 assert.equal(plan.message.bcc.length,0);
 assert.equal((plan.message.body.match(/\n21\d{3}\. Товар /g)||[]).length,10);
 assert.ok(plan.message.body.includes('ОГРН:'));
 assert.match(plan.fingerprint,/^[0-9a-f]{64}$/);
});
test('no flag: never reads source, reserves DB claim or sends Gmail',async()=>{
 const store=memoryStore(),transport=simulatedGmail();
 await assert.rejects(dispatchSelfTest6217({
  ...common(),enabled:false,store,transport
 }),{code:'GMAIL_DISPATCH_DISABLED'});
 assert.equal(store.map.size,0);assert.equal(transport.sends,0);
});
test('correct signed approval: exactly one Gmail acceptance and Sent verification',async()=>{
 const t=await approved();
 const first=await dispatchSelfTest6217(t),second=await dispatchSelfTest6217(t);
 assert.equal(first.status,'VERIFIED');
 assert.equal(second.status,'BLOCKED_ALREADY_CLAIMED');
 assert.equal(t.transport.sends,1);assert.equal(t.store.map.size,1);
});
test('forged or expired approval blocks before Gmail and claim',async()=>{
 const t=await approved();
 await assert.rejects(dispatchSelfTest6217({...t,approvalReceipt:t.approvalReceipt.slice(0,-3)+'bad'}));
 assert.equal(t.transport.sends,0);assert.equal(t.store.map.size,0);
 const preview=await prepareSelfTest6217(common());
 const old=issueApprovalReceipt({orderId:'6217',recipient:own,userMessageId,
  fingerprint:preview.plan.fingerprint,mode:'SELF_TEST'},secret,Date.now()-11*60*1000);
 await assert.rejects(dispatchSelfTest6217({...t,approvalReceipt:old}),{code:'APPROVAL_RECEIPT_SCOPE_OR_TTL_INVALID'});
 assert.equal(t.transport.sends,0);
});
test('unconfirmed historical bank card: block without DB claim or Gmail',async()=>{
 const t=await approved();
 await assert.rejects(dispatchSelfTest6217({...t,provisionalCard:{...card,bankAccount:'9'.repeat(20)}}),{code:'HISTORICAL_CARD_MISMATCH'});
 await assert.rejects(dispatchSelfTest6217({...t,provisionalCard:{...card,ogrn:''}}),{code:'HISTORICAL_CARD_INCOMPLETE'});
 assert.equal(t.store.map.size,0);assert.equal(t.transport.sends,0);
});
test('order changes between preview and last verification: signed approval void',async()=>{
 const t=await approved();let reads=0;
 t.loadOrder=async()=>{reads++;const x=structuredClone(order);
  if(reads>=3)x.positions[0].quantity=999;return x;};
 await assert.rejects(dispatchSelfTest6217(t),{code:'FULL_ORDER_SELECTION_MISMATCH'});
 assert.equal(t.transport.sends,0);assert.equal(t.store.map.size,0);
});
test('different recipient invalidates existing signature and cannot send',async()=>{
 const t=await approved();
 await assert.rejects(dispatchSelfTest6217({...t,ownEmail:'other@example.org'}));
 assert.equal(t.transport.sends,0);
});
test('attachments cannot be injected through self-test interface',async()=>{
 const t=await approved();
 const p=await dispatchSelfTest6217({...t,attachments:[{filename:'wrong.pdf',bytes:Buffer.from('invalid')}]});
 assert.equal(p.status,'VERIFIED');
 assert.equal(t.transport.sends,1);
});
test('Gmail ambiguous failure never permits an automatic retry',async()=>{
 const t=await approved();
 t.transport={sends:0,async send(){this.sends++;throw Error('Gmail timeout');},
  async readSent(){throw Error('readback unavailable');}};
 const first=await dispatchSelfTest6217(t),second=await dispatchSelfTest6217(t);
 assert.equal(first.status,'UNKNOWN');
 assert.equal(first.automaticRetryAllowed,false);
 assert.equal(second.status,'BLOCKED_ALREADY_CLAIMED');
 assert.equal(t.transport.sends,1);
});
