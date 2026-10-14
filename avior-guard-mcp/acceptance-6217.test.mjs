import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareFullSupplierRequest,executeApprovedFullSupplierRequest,verifyCandidate} from './guarded-supplier-strict.mjs';

// Frozen replay of actual Google Sheet "6217 — заявка", tab "1. Заявка 6217", rows 6–15,
// read 2026-10-14. This is NOT a live Sheets or Gmail adapter.
const original=[
['21212','Вафельное полотно: ширина - 80 см, рулон - 50 метров',10,'Рулон'],
['21213','Диск алмазный отрезной Hilberg турбо ультратонкий 125x22.23 Hard Materials X-type',50,'шт'],
['21214','Алюминиевое правило 1 ребро жесткости, L-3,0 м.',20,'шт'],
['21215','Алюмининевое правило прямоугольное 70*30 L-3.0',20,'шт'],
['21216','Плиткорез 300 мм',2,'шт'],
['21217','Плиткорез 600 мм',1,'шт'],
['21218','Сверло по керамограниту 4 грани 6мм',100,'шт'],
['21219','Наборы ключей имбусовых TORX',2,'шт'],
['21220','Набор отверток SL+PH WDK-SD1006',2,'шт'],
['21221','Монтировка с пластиковой накладкой (500мм)',5,'шт']];
const order={orderId:'6217',isVerified:true,sourceId:'SNAPSHOT_6217_2026_10_14',positions:original.map(v=>({number:Number(v[0]),name:v[1],quantity:v[2],unit:v[3]}))};
// Historical full company card emailed by AVIOR 7 October; not independently refreshed.
const company={isVerified:true,verifiedSource:'HISTORICAL_AVIOR_CARD_2026_10_07',
legalName:'Общество с ограниченной ответственностью «АВИОР»',
inn:'5017134957',kpp:'501701001',ogrn:'1235000160713',
legalAddress:'143600, Московская область, Волоколамский г.о., г.Волоколамск, ул.Панфилова, д.5, часть 1/2, помещ.24',
bankAccount:'40702810502860023762',bankName:'АО «АЛЬФА-БАНК»',
bik:'044525593',correspondentAccount:'30101810200000000593'};
const supplier={isVerified:true,supplierId:'SATURN_REPLY_CONFIRMED',authorizedEmails:['yorshikov@pd.saturn.net']};
const intent={orderId:'6217',userMessageId:'REPLAY_NOT_AUTHORIZATION',to:'yorshikov@pd.saturn.net',
positions:structuredClone(order.positions),deliveryAddress:'Москва, ЖК «Остров 7.2»',
paymentTerms:'Отсрочка 30 календарных дней при возможности',
deliveryTerms:'Просим указать срок и стоимость доставки',
requestedVat:'НДС с указанием ставки',requiredAttachments:[]};
const prepare=(i=intent,c=company,s=supplier,files=[])=>prepareFullSupplierRequest({intent:i,order,company:c,supplier:s,attachments:files});
const transport=()=>{let sends=0;return {send:async()=>{sends++;return {messageId:'MOCK_ONLY'};},readSent:async()=>null,get sends(){return sends}};};
const execute=(t,options={})=>executeApprovedFullSupplierRequest({
intent:options.intent||intent,approval:options.approval,
loadOrder:options.loadOrder|| (async()=>order),
loadCompany:async()=>options.company||company,loadSupplier:async()=>options.supplier||supplier,
attachments:options.attachments||[],transport:t});
const expectBlock=async (options)=>{const t=transport();await assert.rejects(execute(t,options));assert.equal(t.sends,0);};

test('Real order 6217: all ten exact items and all nine company fields in generated email',()=>{
assert.equal(order.positions.length,10);const msg=prepare().message;assert.equal(msg.attachments.length,0);
assert.deepEqual(msg.to,['yorshikov@pd.saturn.net']);
for(const p of order.positions)assert.ok(msg.body.includes(p.name+' — '+p.quantity+' '+p.unit));
for(const k of ['legalName','inn','kpp','ogrn','legalAddress','bankAccount','bankName','bik','correspondentAccount'])
assert.ok(msg.body.includes(company[k]),k);
});
test('Original incomplete supplier letter is blocked as modified outbound candidate',()=>{
const msg=prepare().message;
const realSentBody='Добрый день!\nПросим выставить счёт на имеющиеся позиции по заявке №6217.\nС уважением,\nООО «АВИОР»';
assert.ok(!realSentBody.includes(company.ogrn));
assert.throws(()=>verifyCandidate({...msg,body:realSentBody},msg),{code:'OUTBOUND_CANDIDATE_MISMATCH'});
});
test('Pre-send candidate tampering (recipient, quantity, missing OGRN, unknown attachment) blocked',()=>{
const m=prepare().message;for(const altered of [
{...m,to:['attacker@example.com']},
{...m,body:m.body.replace('— 50 шт','— 500 шт')},
{...m,body:m.body.replace(company.ogrn,'')},
{...m,attachments:[{filename:'other.pdf',sha256:'0'.repeat(64)}]}
])assert.throws(()=>verifyCandidate(altered,m),{code:'OUTBOUND_CANDIDATE_MISMATCH'});
});
test('Omitted 10th position fails before candidate construction',()=>{
const subset=structuredClone(intent);subset.positions.pop();
assert.throws(()=>prepare(subset),{code:'FULL_ORDER_SELECTION_MISMATCH'});
});
test('Changed source quantity fails before candidate construction',()=>{
const changed=structuredClone(intent);changed.positions[1].quantity=1000;
assert.throws(()=>prepare(changed),{code:'FULL_ORDER_SELECTION_MISMATCH'});
});
test('No user approval: transport.send never invoked',async()=>expectBlock({}));
test('Invalid requisites even with approval: send never invoked',async()=>{
const approval={confirmed:true,userMessageId:intent.userMessageId,fingerprint:prepare().fingerprint};
await expectBlock({approval,company:{...company,ogrn:''}});
});
test('Wrong address: transport.send never invoked',async()=>expectBlock({intent:{...intent,to:'wrong@example.com'}}));
test('Additional unauthorized file: transport.send never invoked',async()=>expectBlock({attachments:[{filename:'foreign.pdf',bytes:Buffer.from('bad')}] }));
test('Reduced order: transport.send never invoked',async()=>expectBlock({intent:{...intent,positions:intent.positions.slice(0,9)}}));
test('Changed fresh order: transport.send never invoked even with historical approval',async()=>{
const approval={confirmed:true,userMessageId:intent.userMessageId,fingerprint:prepare().fingerprint};
const newer=structuredClone(order);newer.positions.push({number:21222,name:'New item',quantity:1,unit:'шт'});
await expectBlock({approval,loadOrder:async()=>newer});
});
test('Correct approved message reaches MOCK ONLY; independently read back',async()=>{
const p=prepare();let n=0;
const t={send:async()=>{n++;return {messageId:'MOCK_ONLY'}},
readSent:async id=>({messageId:id,...p.message})};
const result=await execute(t,{approval:{confirmed:true,userMessageId:intent.userMessageId,fingerprint:p.fingerprint}});
assert.equal(result.status,'VERIFIED');assert.equal(n,1);
});