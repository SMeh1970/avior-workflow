import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHistoricalCompanyCard,readPinnedCard} from './browser-selftest-card.mjs';

const dummy='test-google-access-token-for-unit-test';
const mailbox='owner@example.com';
const response=value=>new Response(JSON.stringify(value),{status:200,headers:{'content-type':'application/json'}});
test('rejects unsourced pasted business card',()=>{
 assert.throws(()=>parseHistoricalCompanyCard('not a proven historical source'),/HISTORICAL_EMAIL_UNRECOGNIZED/);
});
test('wrong Gmail identity is rejected before loading any email',async()=>{
 let calls=0;
 const fetcher=async url=>{calls++;assert.match(String(url),/\/profile$/);return response({emailAddress:'different@example.com'});};
 await assert.rejects(()=>readPinnedCard({googleToken:dummy,ownEmail:mailbox,fetcher}),/GOOGLE_MAILBOX_MISMATCH/);
 assert.equal(calls,1);
});
test('fixed historical message must be in Gmail Sent and match required ID',async()=>{
 let calls=0;
 const fetcher=async url=>{
  calls++;
  if(String(url).endsWith('/profile'))return response({emailAddress:mailbox});
  assert.match(String(url),/messages\/1a115fa4e9cb912a\?format=full$/);
  return response({id:'1a115fa4e9cb912a',labelIds:['INBOX'],payload:{mimeType:'text/plain',body:{data:'dGVzdA'}}});
 };
 await assert.rejects(()=>readPinnedCard({googleToken:dummy,ownEmail:mailbox,fetcher}),/HISTORICAL_CARD_SOURCE_INVALID/);
 assert.equal(calls,2);
});
test('Gmail message with invented or corrupted card cannot pass pinned hash',async()=>{
 const body='ИНФОРМАЦИОННАЯ КАРТОЧКА\nПолное наименование\nТест\nИНН\n123\n';
 const fetcher=async url=>String(url).endsWith('/profile')?response({emailAddress:mailbox}):
 response({id:'1a115fa4e9cb912a',labelIds:['SENT'],payload:{mimeType:'text/plain',body:{data:Buffer.from(body).toString('base64url')}}});
 await assert.rejects(()=>readPinnedCard({googleToken:dummy,ownEmail:mailbox,fetcher}),/HISTORICAL_CARD_LABEL_MISSING/);
});
