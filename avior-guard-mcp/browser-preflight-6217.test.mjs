import test from 'node:test';
import assert from 'node:assert/strict';
import {routeBrowserPreflight6217} from './browser-preflight-6217.mjs';
const host='https://br-still-wind-b9pzhljq-aviorguard.compute.c-7.eu-central-1.aws.neon.tech';
const env={MCP_AUTH_SIGNING_SECRET:'test-only-preflight-hmac-secret-keep-closed',
 GOOGLE_OAUTH_CLIENT_ID:'mock-client',GOOGLE_OAUTH_CLIENT_SECRET:'mock-client-secret',
 MCP_ALLOWED_GOOGLE_EMAIL:'1043324@gmail.com'};
const req=(path,init)=>new Request(host+path,init);
const start=()=>routeBrowserPreflight6217(req('/selftest/start'),{env});
const tokenResponse=data=>new Response(JSON.stringify(data),{status:200,headers:{'content-type':'application/json'}});
test('anonymous start only redirects to Google with Gmail read-only scope, no send scope',async()=>{
 const r=await start();
 assert.equal(r.status,302);
 const u=new URL(r.headers.get('location'));
 assert.equal(u.origin,'https://accounts.google.com');
 assert.ok(u.searchParams.get('scope').includes('gmail.readonly'));
 assert.equal(u.searchParams.get('scope').includes('gmail.send'),false);
 assert.equal(u.searchParams.get('redirect_uri'),host+'/oauth/google/callback');
 assert.match(r.headers.get('set-cookie'),/HttpOnly/);
});
test('callback cannot run without the bound original browser cookie',async()=>{
 const r=await start(),u=new URL(r.headers.get('location'));
 const cb=await routeBrowserPreflight6217(req('/oauth/google/callback?'+new URLSearchParams({
  state:u.searchParams.get('state'),code:'google-code'
 })),{env,fetcher:()=>{throw Error('GOOGLE_MUST_NOT_BE_ACCESSED');}});
 assert.equal(cb.status,403);
 assert.equal((await cb.json()).reason,'PREFLIGHT_GOOGLE_NOT_CONFIRMED');
});
test('no unauthenticated /selftest/start POST',async()=>{
 const r=await routeBrowserPreflight6217(req('/selftest/start',{method:'POST'}),{env});
 assert.equal(r,null);
});
test('callback rejects Google token without explicit Gmail readonly grant',async()=>{
 const r=await start(),u=new URL(r.headers.get('location'));
 const state=u.searchParams.get('state');
 const cookie=r.headers.get('set-cookie').split(';')[0];
 let calls=0;
 const fetcher=async()=>{calls++;return tokenResponse({id_token:'fake-id',access_token:'mock-access-token',scope:'openid email'});};
 const cb=await routeBrowserPreflight6217(req('/oauth/google/callback?'+new URLSearchParams({state,code:'google-code'}),{headers:{cookie}}),{env,fetcher});
 assert.equal(cb.status,403);
 assert.equal((await cb.json()).reason,'PREFLIGHT_READ_SCOPE_MISSING');
 assert.equal(calls,1);
});
test('selftest is disabled for any configured user other than the fixed owner',async()=>{
 const r=await routeBrowserPreflight6217(req('/selftest/start'),{env:{...env,MCP_ALLOWED_GOOGLE_EMAIL:'other@example.com'}});
 assert.equal(r.status,503);
 assert.equal((await r.json()).reason,'PREFLIGHT_GOOGLE_NOT_CONFIGURED');
});
