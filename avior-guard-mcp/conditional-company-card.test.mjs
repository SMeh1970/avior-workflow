import test from 'node:test';
import assert from 'node:assert/strict';
import {conditionalCardForSelfTest,CONDITIONAL_CARD_REFERENCE,CONDITIONAL_CARD_ACKNOWLEDGEMENT} from './conditional-company-card.mjs';
import {dispatchOnce} from './dispatch-once.mjs';
const own='owner@example.org';
const card={status:'PROVISIONAL',sourceReference:CONDITIONAL_CARD_REFERENCE,isVerified:false,
  legalName:'Общество с ограниченной ответственностью «АВИОР»',inn:'1234567890',kpp:'123456789',ogrn:'1234567890123',
  legalAddress:'Example Moscow address',bankAccount:'12345678901234567890',bankName:'Test bank',bik:'123456789',correspondentAccount:'12345678901234567890'};
const args={historical:card,mode:'SELF_TEST',recipient:own,ownAddress:own,acknowledgement:CONDITIONAL_CARD_ACKNOWLEDGEMENT};
test('conditional historical company card usable only for explicit self-test',()=>{
 const c=conditionalCardForSelfTest(args);
 assert.equal(c.isVerified,true);assert.equal(c.confirmationLevel,'CONDITIONAL');assert.equal(c.productionUsePermitted,false);
 assert.match(c.verifiedSource,/SELF_TEST_ONLY/);
 assert.equal(Object.isFrozen(c),true);
});
test('conditional yes is not a valid supplier-send approval',()=>{
 assert.throws(()=>conditionalCardForSelfTest({...args,mode:'PRODUCTION'}),{code:'PROVISIONAL_CARD_SELF_TEST_ONLY'});
 assert.throws(()=>conditionalCardForSelfTest({...args,recipient:'supplier@example.org'}),{code:'PROVISIONAL_CARD_SELF_TEST_ONLY'});
});
test('different mailbox cannot use conditional company details',()=>{
 assert.throws(()=>conditionalCardForSelfTest({...args,ownAddress:'another@example.org'}),{code:'PROVISIONAL_CARD_SELF_TEST_ONLY'});
});
test('missing explicit acknowledgement is rejected',()=>{
 assert.throws(()=>conditionalCardForSelfTest({...args,acknowledgement:undefined}),{code:'PROVISIONAL_CARD_CONSENT_REQUIRED'});
});
test('unverified or forged source reference rejected',()=>{
 assert.throws(()=>conditionalCardForSelfTest({...args,historical:{...card,sourceReference:'FAKE'}}),{code:'PROVISIONAL_CARD_SOURCE_INVALID'});
 assert.throws(()=>conditionalCardForSelfTest({...args,historical:{...card,isVerified:true}}),{code:'PROVISIONAL_CARD_SOURCE_INVALID'});
});
test('any missing required company field stops self-test',()=>{
 assert.throws(()=>conditionalCardForSelfTest({...args,historical:{...card,ogrn:''}}),{code:'PROVISIONAL_CARD_MISSING_OGRN'});
});
test('self test with provisional card and no signed per-send approval never reaches transport',async()=>{
 let sent=0;const result=dispatchOnce({mode:'SELF_TEST',enabled:true,
  ownAddress:own,
  intent:{to:own,orderId:'6217',userMessageId:'UNIT_TEST',positions:[],cc:[],bcc:[]},
  approval:{confirmed:true,conditionalCompanyCardAcknowledgement:CONDITIONAL_CARD_ACKNOWLEDGEMENT},
  loadOrder:async()=>({isVerified:true,orderId:'6217',sourceId:'REAL_LIVE_TEST',positions:[]}),
  loadCompany:async()=>card,
  loadSupplier:async()=>({isVerified:true,supplierId:'OWN',authorizedEmails:[own]}),
  store:{claim:async()=>{throw Error('DB should not be touched')},finish:async()=>{throw Error('DB should not be touched')}},
  transport:{send:async()=>{sent++;throw Error('must not send')},readSent:async()=>{}},
  approvalSecret:'secret-longer-than-32-characters-1234567890'
 });
 await assert.rejects(result);assert.equal(sent,0);
});