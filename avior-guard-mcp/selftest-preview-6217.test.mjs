import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {preview6217SelfTest,HISTORICAL_CARD_FIELDS} from './selftest-preview-6217.mjs';
const fake={legalName:'Общество с ограниченной ответственностью «ТЕСТ»',inn:'1'.repeat(10),kpp:'2'.repeat(9),ogrn:'3'.repeat(13),
 legalAddress:'Тестовая улица, 1',bankAccount:'4'.repeat(20),bankName:'Тестовый банк',bik:'5'.repeat(9),correspondentAccount:'6'.repeat(20)};
const card=Object.fromEntries(HISTORICAL_CARD_FIELDS.map(k=>[k,fake[k]]));
const expectedCardHash=createHash('sha256').update(JSON.stringify(card)).digest('hex');
const positions=Array.from({length:10},(_,i)=>({number:21212+i,name:'Тестовая позиция '+(i+1),quantity:i+1,unit:'шт'}));
const order={isVerified:true,sourceId:'SHEETS_REGISTRY_AND_ORDER_6217_SHA256_abc',sourceFingerprint:'abc',orderId:'6217',positions,deliveryAddress:'Москва, ЖК «Остров 7.2»'};
const run=(opts={})=>preview6217SelfTest({loadOrder:async()=>order,provisionalCard:card,ownEmail:'owner@example.org',expectedCardHash,...opts});
test('read-only preview: all 10 lines and own recipient; never sends',async()=>{
 const p=await run();assert.equal(p.status,'PREVIEW_ONLY');assert.equal(p.isSendable,false);assert.equal(p.emailsSent,0);
 assert.equal(p.positions,10);assert.equal(p.recipient,'owner@example.org');assert.equal(p.companyFieldsMatched,9);
 assert.match(p.draftFingerprint,/^[0-9a-f]{64}$/);
});
test('wrong or missing provisional bank details fail closed',async()=>{
 await assert.rejects(run({provisionalCard:{...card,bankAccount:'0'.repeat(20)}}),{code:'HISTORICAL_CARD_MISMATCH'});
 const q={...card};delete q.ogrn;await assert.rejects(run({provisionalCard:q}),{code:'HISTORICAL_CARD_INCOMPLETE'});
});
test('caller cannot smuggle verification flags',async()=>{
 await assert.rejects(run({provisionalCard:{...card,isVerified:true}}),{code:'HISTORICAL_CARD_INCOMPLETE'});
});
test('wrong source, unverified data and shortened order fail',async()=>{
 await assert.rejects(run({loadOrder:async()=>({...order,isVerified:false})}),{code:'LIVE_ORDER_NOT_VERIFIED'});
 await assert.rejects(run({loadOrder:async()=>({...order,sourceId:'NOT_CANONICAL'})}),{code:'LIVE_ORDER_NOT_VERIFIED'});
 await assert.rejects(run({loadOrder:async()=>({...order,positions:positions.slice(1)})}),{code:'LIVE_ORDER_NOT_VERIFIED'});
});
test('invalid mailbox fails before source loads',async()=>{
 await assert.rejects(run({ownEmail:'invalid'}),{code:'VERIFIED_ACCOUNT_REQUIRED'});
});
test('fingerprint changes if live quantity changes',async()=>{
 const a=await run(),b=await run();assert.equal(a.draftFingerprint,b.draftFingerprint);
 const c=await run({loadOrder:async()=>({...order,positions:positions.map((x,i)=>i===0?{...x,quantity:200}:x)})});
 assert.notEqual(a.draftFingerprint,c.draftFingerprint);
});
