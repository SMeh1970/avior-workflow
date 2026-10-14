import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

process.env.ENABLE_AVIOR_GMAIL_OAUTH='true';
process.env.GOOGLE_OAUTH_CLIENT_ID='test-client';
process.env.GOOGLE_OAUTH_CLIENT_SECRET='test-secret';
process.env.MCP_ALLOWED_GOOGLE_EMAIL='owner@example.com';
process.env.MCP_AUTH_SIGNING_SECRET='a-long-test-signing-secret-not-for-production';
const base='https://br-still-wind-b9pzhljq-aviorguard.compute.c-7.eu-central-1.aws.neon.tech';
const redirect='https://chatgpt.com/connector_platform_oauth_redirect';
const {routeOAuth}=await import('./oauth.mjs');
const gateway=(await import('./index.mjs')).default;
const challenge=createHash('sha256').update('V'.repeat(50)).digest('base64url');
const req=(p,opts)=>new Request(base+p,opts);
let registered;
async function client(){
 if(registered)return registered;
 const r=await routeOAuth(req('/oauth/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({redirect_uris:[redirect]})}));
 assert.equal(r.status,201);registered=(await r.json()).client_id;
 return registered;
}
async function authorize(options={}){
 const q=new URLSearchParams({client_id:await client(),redirect_uri:redirect,response_type:'code',scope:'avior:gmail-send',code_challenge_method:'S256',code_challenge:challenge,state:'session'});
 for(const [key,val] of Object.entries(options)){
   if(val===null)q.delete(key);else q.set(key,val);
 }
 return routeOAuth(req('/oauth/authorize?'+q));
}
test('missing optional OAuth resource does not block consent',async()=>{
 const r=await authorize();assert.equal(r.status,302);
 const url=new URL(r.headers.get('location'));assert.equal(url.hostname,'accounts.google.com');
 assert.match(url.searchParams.get('scope'),/gmail\.send/);
});
test('registered origin without slash is accepted',async()=>{
 const r=await authorize({resource:base});assert.equal(r.status,302);
});
test('registered resource with slash remains accepted',async()=>{
 const r=await authorize({resource:base+'/'});assert.equal(r.status,302);
});
test('combined read and Gmail scopes accepted and Google consent requests Gmail',async()=>{
 const r=await authorize({scope:'avior:read avior:gmail-send'});assert.equal(r.status,302);
 assert.match(new URL(r.headers.get('location')).searchParams.get('scope'),/gmail\.send/);
});
test('reverse ordered combined scopes accepted',async()=>{
 const r=await authorize({scope:'avior:gmail-send avior:read'});assert.equal(r.status,302);
});
test('unregistered resource rejected with safe diagnostic',async()=>{
 const r=await authorize({resource:'https://hostile.example/'});assert.equal(r.status,400);
 const j=await r.json();assert.equal(j.error_description,'resource_not_recognized');
 assert.ok(!JSON.stringify(j).includes('hostile.example'));
});
test('unknown requested scope rejected, no Google redirect',async()=>{
 const r=await authorize({scope:'avior:gmail-send gmail.modify'});assert.equal(r.status,400);
 assert.equal((await r.json()).error_description,'scope_not_supported');
});
test('duplicate scope rejected instead of creating ambiguous grant',async()=>{
 const r=await authorize({scope:'avior:gmail-send avior:gmail-send'});assert.equal(r.status,400);
 assert.equal((await r.json()).error_description,'scope_not_supported');
});
test('mismatched OAuth redirect URI rejected with safe diagnostic',async()=>{
 const r=await authorize({redirect_uri:'https://evil.example/return'});assert.equal(r.status,400);
 assert.equal((await r.json()).error_description,'redirect_uri_not_registered');
});
test('client not registered returns useful error code',async()=>{
 const r=await authorize({client_id:'not-signed'});assert.equal(r.status,400);
 assert.equal((await r.json()).error_description,'oauth_client_invalid_or_expired');
});
test('malformed PKCE challenge rejected with safe diagnostic',async()=>{
 const r=await authorize({code_challenge:'weak'});assert.equal(r.status,400);
 assert.equal((await r.json()).error_description,'pkce_s256_required');
});
test('missing state rejected with safe diagnostic',async()=>{
 const r=await authorize({state:null});assert.equal(r.status,400);
 assert.equal((await r.json()).error_description,'state_missing_or_invalid');
});
test('Gmail status accurately reports consent enabled but sending OFF',async()=>{
 const r=await gateway.fetch(req('/',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'avior_gmail_status',arguments:{}}})}));
 const data=await r.json();const status=JSON.parse(data.result.content[0].text);
 assert.equal(status.google_oauth_for_gmail_enabled,true);assert.equal(status.gmail_send_enabled,false);
});