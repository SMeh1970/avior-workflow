import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

process.env.GOOGLE_OAUTH_CLIENT_ID='test-google-client';
process.env.GOOGLE_OAUTH_CLIENT_SECRET='test-google-secret';
process.env.MCP_ALLOWED_GOOGLE_EMAIL='owner@example.com';
process.env.MCP_AUTH_SIGNING_SECRET='unit-test-signing-secret-for-OAuth-v2-2026';
process.env.ENABLE_AVIOR_GMAIL_OAUTH='false';
const module=await import('./oauth.mjs');
const HOST='https://br-still-wind-b9pzhljq-aviorguard.compute.c-7.eu-central-1.aws.neon.tech';
const RESOURCE=HOST+'/';
const REDIRECT='https://chatgpt.com/connector_platform_oauth_redirect';
const VERIFIER='S'.repeat(50);
const CHALLENGE=createHash('sha256').update(VERIFIER).digest('base64url');
function req(path,{method='GET',body,headers={}}={}){
 return new Request(HOST+path,{method,headers,...(body!==undefined?{body}:{} )});
}
async function postForm(path,params){return module.routeOAuth(req(path,{method:'POST',body:new URLSearchParams(params).toString(),headers:{'content-type':'application/x-www-form-urlencoded'}}));}
function stubResponse(body){return new Response(JSON.stringify(body),{status:200,headers:{'content-type':'application/json'}})}
async function signIn(scope='avior:read'){
 const registration=await module.routeOAuth(req('/oauth/register',{method:'POST',body:JSON.stringify({redirect_uris:[REDIRECT]}),headers:{'content-type':'application/json'}}));
 assert.equal(registration.status,201);
 const client=await registration.json();
 const q=new URLSearchParams({client_id:client.client_id,redirect_uri:REDIRECT,resource:RESOURCE,response_type:'code',scope,code_challenge_method:'S256',code_challenge:CHALLENGE,state:'test-session'});
 const authorization=await module.routeOAuth(req('/oauth/authorize?'+q));
 assert.equal(authorization.status,302);
 const google=new URL(authorization.headers.get('location'));
 const state=google.searchParams.get('state');
 assert.equal(google.searchParams.get('scope'),'openid email');
 const previous=globalThis.fetch;
 try{
  globalThis.fetch=async url=>{
   if(String(url).startsWith('https://oauth2.googleapis.com/tokeninfo'))return stubResponse({sub:'stable-google-user',email:'owner@example.com',email_verified:true,aud:process.env.GOOGLE_OAUTH_CLIENT_ID,iss:'https://accounts.google.com',nonce:google.searchParams.get('nonce')});
   if(String(url)==='https://oauth2.googleapis.com/token')return stubResponse({id_token:'test-id-token',access_token:'google-token-fake'});
   throw Error('UNEXPECTED_REMOTE_CALL');
  };
  const callback=await module.routeOAuth(req('/oauth/google/callback?'+new URLSearchParams({state,code:'mock-one-time-code'}),{headers:{cookie:authorization.headers.get('set-cookie').split(';')[0]}}));
  assert.equal(callback.status,302);
  const code=new URL(callback.headers.get('location')).searchParams.get('code');
  const exchanged=await postForm('/oauth/token',{grant_type:'authorization_code',code,client_id:client.client_id,redirect_uri:REDIRECT,resource:RESOURCE,code_verifier:VERIFIER});
  assert.equal(exchanged.status,200);
  return {client,token:await exchanged.json()};
 }finally{globalThis.fetch=previous}
}
const schema=()=>module.routeOAuth(req('/.well-known/oauth-authorization-server'));

test('OAuth metadata advertises standards-compatible refresh_token grant',async()=>{
 const r=await schema();assert.equal(r.status,200);const meta=await r.json();
 assert.deepEqual(meta.grant_types_supported,['authorization_code','refresh_token']);
 assert.equal(meta.token_endpoint,HOST+'/oauth/token');
});
test('read grant receives a refresh token, not merely a 20-minute bearer',async()=>{
 const {token}=await signIn();
 assert.equal(token.expires_in,3600);
 assert.equal(token.scope,'avior:read');
 assert.ok(typeof token.refresh_token==='string'&&token.refresh_token.length>64);
 assert.ok(module.checkAccess(req('/',{headers:{authorization:'Bearer '+token.access_token}})));
});
test('refresh allows valid read-only access without a Google OAuth popup',async()=>{
 const {client,token}=await signIn();
 // No mock Google endpoints remain configured: a refresh attempt must not access Google.
 const r=await postForm('/oauth/token',{grant_type:'refresh_token',client_id:client.client_id,refresh_token:token.refresh_token,resource:RESOURCE});
 assert.equal(r.status,200);
 const updated=await r.json();
 assert.equal(updated.expires_in,3600);
 assert.equal(updated.scope,'avior:read');
 assert.ok(updated.refresh_token);
 assert.ok(module.checkAccess(req('/',{headers:{authorization:'Bearer '+updated.access_token}})));
 assert.ok(!module.checkAccess(req('/',{headers:{authorization:'Bearer '+updated.access_token}}),'avior:gmail-send'));
});
test('refresh does not authorize Gmail send even when read token is valid',async()=>{
 const {client,token}=await signIn();
 const renewed=await (await postForm('/oauth/token',{grant_type:'refresh_token',client_id:client.client_id,refresh_token:token.refresh_token})).json();
 assert.equal(module.authorizedGmailAccess(req('/',{headers:{authorization:'Bearer '+renewed.access_token}})),null);
});
test('forged refresh token rejected',async()=>{
 const {client,token}=await signIn();
 const bogus=token.refresh_token.slice(0,-1)+(token.refresh_token.endsWith('x')?'y':'x');
 const r=await postForm('/oauth/token',{grant_type:'refresh_token',client_id:client.client_id,refresh_token:bogus});
 assert.equal(r.status,400);assert.equal((await r.json()).error,'invalid_grant');
});
test('refresh token bound to registering OAuth client',async()=>{
 const one=await signIn(),two=await signIn();
 assert.notEqual(one.client.client_id,two.client.client_id);
 const r=await postForm('/oauth/token',{grant_type:'refresh_token',client_id:two.client.client_id,refresh_token:one.token.refresh_token});
 assert.equal(r.status,400);
 const wrong=await postForm('/oauth/token',{grant_type:'refresh_token',client_id:'wrong-client-id',refresh_token:one.token.refresh_token});
 assert.equal(wrong.status,400);
});
test('mismatched requested scope and OAuth resource rejected',async()=>{
 const {client,token}=await signIn();
 const wrongScope=await postForm('/oauth/token',{grant_type:'refresh_token',client_id:client.client_id,refresh_token:token.refresh_token,scope:'avior:gmail-send'});
 assert.equal(wrongScope.status,400);
 const wrongResource=await postForm('/oauth/token',{grant_type:'refresh_token',client_id:client.client_id,refresh_token:token.refresh_token,resource:'https://other.example/'});
 assert.equal(wrongResource.status,400);
});
test('expired or missing token cannot refresh; existing read route stays protected',async()=>{
 const missing=await postForm('/oauth/token',{grant_type:'refresh_token',client_id:'x'});
 assert.equal(missing.status,400);
 assert.equal(module.checkAccess(req('/')),false);
 assert.equal(module.checkAccess(req('/',{headers:{authorization:'Bearer incorrect'}})),false);
});
test('OAuth discovery still advertises only pre-existing read scope while Gmail disabled',async()=>{
 const m=await (await schema()).json();
 assert.deepEqual(m.scopes_supported,['avior:read']);
 const protectedMeta=await (await module.routeOAuth(req('/.well-known/oauth-protected-resource'))).json();
 assert.deepEqual(protectedMeta.scopes_supported,['avior:read']);
});