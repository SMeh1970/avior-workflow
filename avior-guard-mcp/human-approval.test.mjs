import test from 'node:test';
import assert from 'node:assert/strict';
import {makeHumanReviewUrl,routeHumanReview,approvalSecretFromEnv} from './human-approval.mjs';
import {verifyApprovalReceipt} from './approval-receipt.mjs';

const HOST='https://br-still-wind-b9pzhljq-aviorguard.compute.c-7.eu-central-1.aws.neon.tech';
const own='owner@example.org';
const userMessageId='HUMAN_REVIEW_TEST_6217';
const fingerprint='a'.repeat(64);
const env={
 MCP_AUTH_SIGNING_SECRET:'test-only-separate-browser-signing-root-secret-long-enough',
 MCP_ALLOWED_GOOGLE_EMAIL:own,
 GOOGLE_OAUTH_CLIENT_ID:'test-client-id.apps.googleusercontent.com',
 GOOGLE_OAUTH_CLIENT_SECRET:'fake-google-client-secret'
};
const plan={fingerprint,message:{
 to:[own],cc:[],bcc:[],attachments:[],
 subject:'Заявка №6217 — контрольное письмо',
 body:'Добрый день!\nТовар 1 — 5 шт\nРеквизиты ООО «АВИОР»:\nОГРН: 1234567890123'
}};
const reviewUrl=()=>makeHumanReviewUrl({plan,userMessageId,ownEmail:own,env});
const request=(url,params={})=>new Request(url,params);
const open=(url,opts={})=>routeHumanReview(request(url,opts),{env});
test('only exact SELF_TEST plan can produce encrypted review URL',()=>{
 assert.match(reviewUrl(),/\/selftest\/review\?t=hav1\./);
 assert.throws(()=>makeHumanReviewUrl({plan:{...plan,message:{...plan.message,to:['supplier@example.org']}},userMessageId,ownEmail:own,env}),{code:'REVIEW_PLAN_NOT_SELF_ONLY'});
 assert.throws(()=>makeHumanReviewUrl({plan:{...plan,message:{...plan.message,attachments:[{filename:'x.pdf'}]}},userMessageId,ownEmail:own,env}),{code:'REVIEW_PLAN_NOT_SELF_ONLY'});
});
test('preview page shows exact letter, not a Gmail send action',async()=>{
 const r=await open(reviewUrl());
 assert.equal(r.status,200);
 const body=await r.text();
 assert.ok(body.includes('Товар 1 — 5 шт'));
 assert.ok(body.includes('Подтвердить именно это тестовое письмо через Google'));
 assert.ok(!body.includes('messages/send'));
});
test('tampered review ticket and expired link fail before Google redirect',async()=>{
 const link=reviewUrl(),tampered=link.slice(0,-3)+'bad';
 assert.equal((await open(tampered)).status,403);
 const old=makeHumanReviewUrl({plan,userMessageId,ownEmail:own,env,now:Date.now()-11*60*1000});
 assert.equal((await open(old)).status,403);
});
test('form POST requires exact first-party Origin',async()=>{
 const token=new URL(reviewUrl()).searchParams.get('t');
 const form=new URLSearchParams({ticket:token});
 const r=await open(HOST+'/selftest/approve',{method:'POST',body:form});
 assert.equal(r.status,403);
});
test('Google sign-in binds browser click, user identity and exact fingerprint to signed receipt',async()=>{
 const token=new URL(reviewUrl()).searchParams.get('t');
 const post=await open(HOST+'/selftest/approve',{
  method:'POST',headers:{origin:HOST,'content-type':'application/x-www-form-urlencoded'},
  body:new URLSearchParams({ticket:token})
 });
 assert.equal(post.status,302);
 const google=new URL(post.headers.get('location'));
 assert.equal(google.hostname,'accounts.google.com');
 assert.equal(google.searchParams.get('scope'),'openid email');
 assert.equal(google.searchParams.get('redirect_uri'),HOST+'/oauth/google/callback');
 const cookie=post.headers.get('set-cookie').split(';')[0];
 const fakeFetch=async(url)=>{
  if(String(url).startsWith('https://oauth2.googleapis.com/tokeninfo')){
   return {ok:true,json:async()=>({
    email:own,email_verified:'true',aud:env.GOOGLE_OAUTH_CLIENT_ID,
    iss:'https://accounts.google.com',sub:'fake-user',
    nonce:google.searchParams.get('nonce')
   })};
  }
  if(String(url)==='https://oauth2.googleapis.com/token')
   return {ok:true,json:async()=>({id_token:'mock-id-token'})};
  throw Error('unexpected URL');
 };
 const callback=HOST+'/oauth/google/callback?'+new URLSearchParams({
  state:google.searchParams.get('state'),code:'mock-auth-code'
 });
 const r=await routeHumanReview(request(callback,{headers:{cookie}}),{env,fetcher:fakeFetch});
 assert.equal(r.status,200);
 const body=await r.text();
 assert.ok(body.includes('Личное подтверждение получено'));
 const receipt=body.match(/<textarea[^>]*>([^<]+)<\/textarea>/)?.[1];
 assert.ok(receipt);
 assert.equal(verifyApprovalReceipt(receipt,{
  orderId:'6217',recipient:own,userMessageId,fingerprint
 },approvalSecretFromEnv(env)),true);
});
test('OAuth callback cannot issue a receipt without the browser confirmation cookie',async()=>{
 const token=new URL(reviewUrl()).searchParams.get('t');
 const r=await open(HOST+'/selftest/approve',{
  method:'POST',headers:{origin:HOST},
  body:new URLSearchParams({ticket:token})
 });
 const google=new URL(r.headers.get('location'));
 const url=HOST+'/oauth/google/callback?'+new URLSearchParams({
  code:'mock-code',state:google.searchParams.get('state')
 });
 const denied=await open(url);
 assert.equal(denied.status,403);
});
