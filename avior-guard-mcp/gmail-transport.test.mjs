import test from 'node:test';
import assert from 'node:assert/strict';
import {makeGmailRaw,authorizedGmailTransport} from './gmail-transport.mjs';

const own='owner@example.org';
const grant='mock-google-token-that-is-long-enough';
const message=()=>({to:[own],cc:[],bcc:[],subject:'Заявка №6217 — самотест AVIOR Guard',
 body:'Добрый день!\nПозиция №21212 — 10 Рулон\nБез отправки поставщикам.',attachments:[]});
function googleMock({actualAccount=own,labels=['SENT'],subject,body,sendHttp=200}={}){
 let sendCount=0,profileCount=0,readCount=0;let accepted=null;
 const fetcher=async (url,opts)=>{
  const path=String(url).split('/users/me/')[1]||'';
  if(path==='profile'){profileCount++;return {ok:true,json:async()=>({emailAddress:actualAccount})};}
  if(path==='messages/send'){
   sendCount++;accepted=JSON.parse(opts.body);
   if(sendHttp!==200)return {ok:false,status:sendHttp};
   return {ok:true,json:async()=>({id:'GMAIL_MOCK_ID'})};
  }
  if(path.startsWith('messages/GMAIL_MOCK_ID?format=full')){
   readCount++;
   const original=message();
   return {ok:true,json:async()=>({
    id:'GMAIL_MOCK_ID',labelIds:labels,
    payload:{mimeType:'text/plain',
      headers:[
       {name:'To',value:own},
       {name:'Subject',value:'=?UTF-8?B?'+Buffer.from(subject||original.subject,'utf8').toString('base64')+'?='}
      ],
      body:{data:Buffer.from(body||original.body.replace(/\n/g,'\r\n')).toString('base64url')}
    }
   })};
  }
  throw Error('Unexpected mock Google endpoint: '+path);
 };
 return {fetcher,get sends(){return sendCount;},get reads(){return readCount;},
  get profiles(){return profileCount;},get lastRaw(){return accepted?.raw;}};
}
const build=(mock,more={})=>authorizedGmailTransport({
 fetcher:mock.fetcher,googleToken:grant,verifiedAccount:own,
 allowedRecipient:own,enabled:true,...more
});
test('Gmail MIME serializes a single exact UTF-8 To, Subject, and text body',()=>{
 const raw=Buffer.from(makeGmailRaw(message()),'base64url').toString('utf8');
 assert.match(raw,/^To: owner@example.org\r\n/);
 assert.ok(raw.includes('Subject: =?UTF-8?B?'));
 assert.ok(raw.includes('Content-Type: text\/plain; charset=UTF-8'));
 assert.ok(!raw.includes('\r\nCc:'));assert.ok(!raw.includes('\r\nBcc:'));
});
test('successful Gmail send requires sender profile and independently reads SENT copy',async()=>{
 const m=googleMock(),transport=build(m);
 assert.deepEqual(await transport.send(message()),{messageId:'GMAIL_MOCK_ID'});
 const r=await transport.readSent('GMAIL_MOCK_ID');
 assert.equal(r.to[0],own);assert.equal(r.subject,message().subject);
 assert.equal(r.body,message().body);
 assert.deepEqual(r.attachments,[]);
 assert.equal(m.sends,1);assert.equal(m.reads,1);assert.equal(m.profiles,1);
});
test('wrong Google account blocks before messages/send',async()=>{
 const m=googleMock({actualAccount:'other@example.org'});
 await assert.rejects(build(m).send(message()),{code:'GOOGLE_ACCOUNT_MISMATCH'});
 assert.equal(m.sends,0);
});
test('wrong primary recipient, Cc, Bcc and header injection block Gmail',async()=>{
 const m=googleMock();const t=build(m);
 for(const draft of [
  {...message(),to:['supplier@example.org']},
  {...message(),cc:['other@example.org']},
  {...message(),bcc:['other@example.org']},
  {...message(),subject:'hello\r\nBcc: attacker@example.org'}
 ])await assert.rejects(t.send(draft));
 assert.equal(m.sends,0);
});
test('attachment rejected until a separately approved attachment-enabled workflow exists',async()=>{
 const m=googleMock(),t=build(m);
 await assert.rejects(t.send({...message(),attachments:[{filename:'fake.pdf',sha256:'0'.repeat(64)}]}),{code:'ATTACHMENTS_SEND_REQUIRES_EXTRA_VALIDATION'});
 assert.equal(m.sends,0);
});
test('missing SENT label aborts independent confirmation',async()=>{
 const m=googleMock({labels:['INBOX']}),t=build(m);
 await t.send(message());
 await assert.rejects(t.readSent('GMAIL_MOCK_ID'),{code:'NOT_IN_SENT'});
});
test('Gmail HTTP 500 never masquerades as successful send',async()=>{
 const m=googleMock({sendHttp:500}),t=build(m);
 await assert.rejects(t.send(message()),{code:'GMAIL_API_HTTP_500'});
 assert.equal(m.sends,1);assert.equal(m.reads,0);
});
test('transport cannot start without explicit enabled flag and valid capability',()=>{
 const m=googleMock();
 assert.throws(()=>build(m,{enabled:false}),{code:'GMAIL_SEND_DISABLED'});
 assert.throws(()=>build(m,{googleToken:'invalid'}),{code:'GMAIL_AUTH_INVALID'});
 assert.equal(m.sends,0);
});
