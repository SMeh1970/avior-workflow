import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareSupplierRequest,executeApprovedSupplierRequest,digestAttachment} from './guarded-supplier-request.mjs';
const copy=x=>structuredClone(x);
const card={isVerified:true,verifiedSource:'CONFIRMED_CARD',legalName:'Общество с ограниченной ответственностью «АВИОР»',
 inn:'5017134957',kpp:'501701001',ogrn:'1235000160713',
 legalAddress:'143600, Московская область, г. Волоколамск, ул. Панфилова, дом 5',
 bankAccount:'40702810502860023762',bankName:'АО «АЛЬФА-БАНК»',bik:'044525593',correspondentAccount:'30101810200000000593'};
const order={orderId:'6217',isVerified:true,sourceId:'LIVE_TEST_ORDER',positions:[
 {number:1,name:'Вафельное полотно 80 см, 50 метров',unit:'рулон',quantity:10},
 {number:2,name:'Плиткорез 600 мм',unit:'шт',quantity:1}]};
const supplier={isVerified:true,supplierId:'SATURN',authorizedEmails:['yorshikov@pd.saturn.net']};
const file=Buffer.from('exact file bytes');
const attachment={filename:'photo.png',bytes:file};
const intent={orderId:'6217',userMessageId:'USER_MESSAGE_001',to:'yorshikov@pd.saturn.net',
 positions:copy(order.positions),deliveryAddress:'Москва, ЖК Остров 7.2',paymentTerms:'30 дней при согласовании',
 deliveryTerms:'Согласовать стоимость доставки',requestedVat:'НДС с указанием ставки',
 requiredAttachments:[{filename:'photo.png',sha256:digestAttachment(file),sourceRef:'ORIGINAL_6217'}]};
const prepare=mod=>prepareSupplierRequest({intent:mod?.intent||copy(intent),order:mod?.order||copy(order),company:mod?.company||copy(card),
 supplier:mod?.supplier||copy(supplier),attachments:mod?.attachments||[attachment]});
const altered=(obj,key,value)=>({...copy(obj),[key]:value});
function blocked(code,mod){assert.throws(()=>prepare(mod),e=>e.code===code);}
test('constructs full verified requisites in actual email body',()=>{
 const m=prepare().message;
 for(const k of ['legalName','inn','kpp','ogrn','legalAddress','bankAccount','bankName','bik','correspondentAccount'])
 assert.ok(m.body.includes(card[k]),k);
 assert.deepEqual(m.to,['yorshikov@pd.saturn.net']);assert.deepEqual(m.cc,[]);assert.deepEqual(m.bcc,[]);
});
test('regression: sent 6217 text without full requisites would fail exact rendering',()=>{
 const original='Добрый день. Просим выставить счёт. С уважением, ООО «АВИОР»';
 assert.notEqual(prepare().message.body,original);
});
test('missing OGRN blocks',()=>blocked('COMPANY_MISSING_OGRN',{company:altered(card,'ogrn','')}));
test('invalid OGRN blocks',()=>blocked('COMPANY_INVALID_OGRN',{company:altered(card,'ogrn','123')}));
test('short legal name blocks',()=>blocked('COMPANY_LEGAL_NAME_INCOMPLETE',{company:altered(card,'legalName','ООО «АВИОР»')}));
test('unverified card blocks',()=>blocked('COMPANY_SOURCE_UNVERIFIED',{company:altered(card,'isVerified',false)}));
test('unverified order blocks',()=>blocked('ORDER_SOURCE_UNVERIFIED',{order:altered(order,'isVerified',false)}));
test('unverified supplier blocks',()=>blocked('SUPPLIER_DIRECTORY_UNVERIFIED',{supplier:altered(supplier,'isVerified',false)}));
test('wrong email blocks',()=>blocked('RECIPIENT_NOT_IN_DIRECTORY',{intent:altered(intent,'to','attacker@example.com')}));
test('missing delivery blocks',()=>blocked('DELIVERY_UNSPECIFIED',{intent:altered(intent,'deliveryAddress','')}));
test('missing terms block',()=>blocked('REQUEST_TERMS_MISSING',{intent:altered(intent,'paymentTerms','')}));
test('missing attachment specification blocks',()=>blocked('ATTACHMENTS_NOT_SPECIFIED',{intent:altered(intent,'requiredAttachments',null)}));
test('missing attachment blocks',()=>blocked('ATTACHMENTS_MISMATCH',{attachments:[]}));
test('wrong attachment blocks',()=>blocked('ATTACHMENT_HASH_MISMATCH',{attachments:[{filename:'photo.png',bytes:Buffer.from('wrong content')}]}));
test('wrong position name blocks',()=>{let i=copy(intent);i.positions[0].name='Подменённый товар';blocked('ORDER_POSITIONS_MISMATCH',{intent:i});});
test('wrong quantity blocks',()=>{let i=copy(intent);i.positions[0].quantity=1000;blocked('ORDER_POSITIONS_MISMATCH',{intent:i});});
test('duplicate position blocks',()=>{let i=copy(intent);i.positions.push({...i.positions[0]});blocked('POSITION_DUPLICATED',{intent:i});});
test('verified subset of order allowed',()=>{let i=copy(intent);i.positions=[i.positions[1]];let body=prepare({intent:i}).message.body;assert.ok(body.includes('Плиткорез'));assert.ok(!body.includes('Вафельное полотно'));});
const adapters=(transport)=>({loadOrder:async()=>copy(order),loadCompany:async()=>copy(card),loadSupplier:async()=>copy(supplier),
 intent:copy(intent),attachments:[attachment],transport});
test('no approval -> Gmail transport is never called',async()=>{
 let n=0;const x=adapters({send:async()=>{n++;return {messageId:'x'}},readSent:async()=>null});
 await assert.rejects(executeApprovedSupplierRequest(x),e=>e.code==='APPROVAL_REQUIRED_OR_STALE');assert.equal(n,0);
});
test('stale approval -> Gmail transport is never called',async()=>{
 let n=0;const x=adapters({send:async()=>{n++;return {messageId:'x'}},readSent:async()=>null});
 x.approval={confirmed:true,userMessageId:intent.userMessageId,fingerprint:prepare().fingerprint};
 x.intent.deliveryAddress='Changed';
 await assert.rejects(executeApprovedSupplierRequest(x),e=>e.code==='APPROVAL_REQUIRED_OR_STALE');assert.equal(n,0);
});
test('fresh source changed -> Gmail transport is never called',async()=>{
 let n=0;const x=adapters({send:async()=>{n++;return {messageId:'x'}},readSent:async()=>null});
 x.approval={confirmed:true,userMessageId:intent.userMessageId,fingerprint:prepare().fingerprint};
 x.loadOrder=async()=>({...copy(order),positions:[{...order.positions[0],quantity:14},order.positions[1]]});
 await assert.rejects(executeApprovedSupplierRequest(x),e=>e.code==='ORDER_POSITIONS_MISMATCH');assert.equal(n,0);
});
test('confirmed message and independent readback -> VERIFIED',async()=>{
 const p=prepare(); const x=adapters({send:async()=>({messageId:'sent-1'}),readSent:async()=>({messageId:'sent-1',...p.message})});
 x.approval={confirmed:true,userMessageId:intent.userMessageId,fingerprint:p.fingerprint};
 assert.equal((await executeApprovedSupplierRequest(x)).status,'VERIFIED');
});
test('readback mismatch -> SENT_BUT_UNVERIFIED, not a false success',async()=>{
 const p=prepare(); const x=adapters({send:async()=>({messageId:'sent-1'}),readSent:async()=>({messageId:'sent-1',...p.message,to:['evil@example.com']})});
 x.approval={confirmed:true,userMessageId:intent.userMessageId,fingerprint:p.fingerprint};
 const r=await executeApprovedSupplierRequest(x);assert.equal(r.status,'SENT_BUT_UNVERIFIED');assert.equal(r.requiresManualReview,true);
});
test('Gmail readback outage -> SENT_BUT_UNVERIFIED',async()=>{
 const p=prepare();const x=adapters({send:async()=>({messageId:'sent-1'}),readSent:async()=>{throw Error('Gmail unavailable')}});
 x.approval={confirmed:true,userMessageId:intent.userMessageId,fingerprint:p.fingerprint};
 assert.equal((await executeApprovedSupplierRequest(x)).status,'SENT_BUT_UNVERIFIED');
});