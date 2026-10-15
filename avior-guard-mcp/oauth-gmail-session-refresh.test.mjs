import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

process.env.ENABLE_AVIOR_GMAIL_OAUTH='true';
process.env.GOOGLE_OAUTH_CLIENT_ID='fake-google-client-for-tests';
process.env.GOOGLE_OAUTH_CLIENT_SECRET='fake-google-secret-for-tests';
process.env.MCP_ALLOWED_GOOGLE_EMAIL='owner@example.com';
process.env.MCP_AUTH_SIGNING_SECRET='test-only-mcp-signing-secret-for-refresh-2026';
const {routeOAuth,authorizedGmailAccess,checkAccess}=await import('./oauth.mjs');
const entry=(await import('./index.mjs')).default;
const host='https://br-still-wind-b9pzhljq-aviorguard.compute.c-7.eu-central-1.aws.neon.tech';
const redirect='https://chatgpt.com/connector_platform_oauth_redirect';
const resource=host+'/';
const verifier='v'.repeat(50);
const challenge=createHash('sha256').update(verifier).digest('base64url');
const makeReq=(path,init)=>new Request(host+path,init);
const json=data=>new Response(JSON.stringify(data),{status:200,headers:{'content-type':'application/json'}});
async function form(data){return routeOAuth(makeReq('/oauth/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams(data)}));}
async function consent(scope){
 const registration=await routeOAuth(makeReq('/oauth/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({redirect_uris:[redirect]})}));
 assert.equal(registration.status,201);const client=await registration.json();
 const q=new URLSearchParams({client_id:client.client_id,redirect_uri:redirect,response_type:'code',resource,scope,code_challenge_method:'S256',code_challenge:challenge,state:'test-state'});
 const authorize=await routeOAuth(makeReq('/oauth/authorize?'+q));assert.equal(authorize.status,302);
 const redirectGoogle=new URL(authorize.headers.get('location'));const state=redirectGoogle.searchParams.get('state');
 assert.match(redirectGoogle.searchParams.get('scope'),/gmail\.send/);
 const prior=globalThis.fetch;
 try{
  globalThis.fetch=async url=>{
   if(String(url).startsWith('https://oauth2.googleapis.com/tokeninfo'))return json({sub:'google-sub-for-tests',email:'owner@example.com',email_verified:true,aud:process.env.GOOGLE_OAUTH_CLIENT_ID,iss:'https://accounts.google.com',nonce:redirectGoogle.searchParams.get('nonce')});
   if(String(url)==='https://oauth2.googleapis.com/token')return json({id_token:'fake-google-id-token',access_token:'fake-google-access-token-for-tests',expires_in:3600,scope:'https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly'});
   throw Error('Unexpected remote request: '+String(url));
  };
  const callback=await routeOAuth(makeReq('/oauth/google/callback?'+new URLSearchParams({state,code:'one-time-test-code'}),{headers:{cookie:authorize.headers.get('set-cookie').split(';')[0]}}));
  assert.equal(callback.status,302);
  const code=new URL(callback.headers.get('location')).searchParams.get('code');
  const grant=await form({grant_type:'authorization_code',code,redirect_uri:redirect,client_id:client.client_id,code_verifier:verifier,resource});
  assert.equal(grant.status,200);
  return {client,token:await grant.json()};
 }finally{globalThis.fetch=prior;}
}
const bearer=t=>makeReq('/',{headers:{authorization:'Bearer '+t}});
async function renew(client,refresh_token,extra={}){return form({grant_type:'refresh_token',client_id:client.client_id,refresh_token,resource,...extra});}

test('Gmail consent issues an MCP session refresh token while Google access stays short-lived',async()=>{
 const {token}=await consent('avior:gmail-send');
 assert.equal(token.expires_in,600);
 assert.equal(token.scope,'avior:gmail-send');
 assert.ok(token.refresh_token?.length>70);
 const capability=authorizedGmailAccess(bearer(token.access_token));
 assert.ok(capability?.access_token?.startsWith('fake-google-access-token'));
});

test('renew Gmail consent session without Google popup, but DO NOT resurrect Google Gmail permission',async()=>{
 const {client,token}=await consent('avior:gmail-send');
 const result=await renew(client,token.refresh_token);
 assert.equal(result.status,200);
 const next=await result.json();
 assert.equal(next.scope,'avior:gmail-send');
 assert.equal(next.expires_in,3600);
 assert.ok(next.refresh_token);
 assert.equal(authorizedGmailAccess(bearer(next.access_token)),null);
 assert.equal(checkAccess(bearer(next.access_token),'avior:read'),false);
 const next2=await renew(client,next.refresh_token);
 assert.equal(next2.status,200);
 assert.equal(authorizedGmailAccess(bearer((await next2.json()).access_token)),null);
});

test('combined read + Gmail consent renews both MCP scopes but cannot silently use Gmail API',async()=>{
 const {client,token}=await consent('avior:read avior:gmail-send');
 assert.equal(token.scope,'avior:read avior:gmail-send');
 const response=await renew(client,token.refresh_token);
 assert.equal(response.status,200);
 const next=await response.json();
 assert.equal(next.scope,'avior:read avior:gmail-send');
 assert.equal(checkAccess(bearer(next.access_token),'avior:read'),true);
 assert.equal(authorizedGmailAccess(bearer(next.access_token)),null);
});

test('refresh never escalates or changes the originally granted scopes',async()=>{
 const {client,token}=await consent('avior:gmail-send');
 const r=await renew(client,token.refresh_token,{scope:'avior:read avior:gmail-send'});
 assert.equal(r.status,400);assert.equal((await r.json()).error,'invalid_grant');
});

test('refresh is bound to the exact OAuth client and rejects tampering',async()=>{
 const {client,token}=await consent('avior:gmail-send');
 const mismatch=await renew({...client,client_id:'wrong-client'},token.refresh_token);
 assert.equal(mismatch.status,400);
 const forged=token.refresh_token.slice(0,-2)+'XX';
 const invalid=await renew(client,forged);assert.equal(invalid.status,400);
});

test('the 10-minute consent session expiry is recoverable without a second Google login',async()=>{
 const {client,token}=await consent('avior:read avior:gmail-send');
 const originalDateNow=Date.now;
 try{
  Date.now=()=>originalDateNow()+11*60*1000;
  assert.equal(checkAccess(bearer(token.access_token),'avior:read'),false);
  const response=await renew(client,token.refresh_token,{scope:'avior:read'});
  assert.equal(response.status,200);
  const refreshed=await response.json();
  assert.equal(refreshed.scope,'avior:read');
  assert.equal(checkAccess(bearer(refreshed.access_token),'avior:read'),true);
  assert.equal(authorizedGmailAccess(bearer(refreshed.access_token)),null);
 }finally{Date.now=originalDateNow}
});

test('refresh cannot add an unconsented scope after read-only Google login',async()=>{
 // This process has Gmail enabled, but the individual initial grant is read-only.
 const {client,token}=await (async()=>{
  const registration=await routeOAuth(makeReq('/oauth/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({redirect_uris:[redirect]})}));
  const c=await registration.json();
  const q=new URLSearchParams({client_id:c.client_id,redirect_uri:redirect,response_type:'code',resource,scope:'avior:read',code_challenge_method:'S256',code_challenge:challenge,state:'test-state'});
  const authorize=await routeOAuth(makeReq('/oauth/authorize?'+q));
  assert.equal(authorize.status,302);
  const google=new URL(authorize.headers.get('location'));
  const prior=globalThis.fetch;
  try{
   globalThis.fetch=async u=>{
    if(String(u).startsWith('https://oauth2.googleapis.com/tokeninfo'))return json({sub:'google-sub-for-tests',email:'owner@example.com',email_verified:true,aud:process.env.GOOGLE_OAUTH_CLIENT_ID,iss:'https://accounts.google.com',nonce:google.searchParams.get('nonce')});
    if(String(u)==='https://oauth2.googleapis.com/token')return json({id_token:'fake-id',access_token:'fake-test-access'});
    throw Error('unexpected request');
   };
   const callback=await routeOAuth(makeReq('/oauth/google/callback?'+new URLSearchParams({state:google.searchParams.get('state'),code:'fake-code'}),{headers:{cookie:authorize.headers.get('set-cookie').split(';')[0]}}));
   const code=new URL(callback.headers.get('location')).searchParams.get('code');
   const exchange=await form({grant_type:'authorization_code',code,client_id:c.client_id,redirect_uri:redirect,resource,code_verifier:verifier});
   assert.equal(exchange.status,200);return {client:c,token:await exchange.json()};
  }finally{globalThis.fetch=prior}
 })();
 const upgrade=await renew(client,token.refresh_token,{scope:'avior:gmail-send'});
 assert.equal(upgrade.status,400);
});
test('stale Gmail MCP scope without a fresh Google Gmail grant forces a new consent challenge',async()=>{
 const {client,token}=await consent('avior:read avior:gmail-send');
 const refreshed=await (await renew(client,token.refresh_token)).json();
 assert.equal(checkAccess(bearer(refreshed.access_token),'avior:gmail-send'),true);
 assert.equal(authorizedGmailAccess(bearer(refreshed.access_token)),null);
 const challenge=await entry.fetch(makeReq('/',{
  method:'POST',
  headers:{'content-type':'application/json',authorization:'Bearer '+refreshed.access_token},
  body:JSON.stringify({jsonrpc:'2.0',id:'fresh-gmail',method:'tools/call',
    params:{name:'avior_gmail_consent_proof',arguments:{}}})
 }));
 assert.equal(challenge.status,401);
 assert.match(challenge.headers.get('www-authenticate'),/avior:gmail-send/);
 const body=await challenge.json();
 assert.equal(body.result.isError,true);
});
