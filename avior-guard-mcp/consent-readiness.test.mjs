import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
process.env.ENABLE_AVIOR_GMAIL_OAUTH='true';
process.env.GOOGLE_OAUTH_CLIENT_ID='test-google-client';
process.env.GOOGLE_OAUTH_CLIENT_SECRET='test-google-secret';
process.env.MCP_ALLOWED_GOOGLE_EMAIL='owner@example.com';
process.env.MCP_AUTH_SIGNING_SECRET='test-guard-signing-secret-should-never-be-used-in-live';
const host='https://br-still-wind-b9pzhljq-aviorguard.compute.c-7.eu-central-1.aws.neon.tech';
const resource=host+'/';
const redirect='https://chatgpt.com/connector_platform_oauth_redirect';
const googleScopes=['https://www.googleapis.com/auth/gmail.send','https://www.googleapis.com/auth/gmail.readonly'];
const {routeOAuth,checkAccess}=await import('./oauth.mjs');
const entry=(await import('./index.mjs')).default;
const verifier='v'.repeat(50);
const pkce=createHash('sha256').update(verifier).digest('base64url');
const req=(p,opts={})=>new Request(host+p,opts);
async function reg(){const r=await routeOAuth(req('/oauth/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({redirect_uris:[redirect]})}));assert.equal(r.status,201);return r.json();}
async function begin(client_id,scope='avior:gmail-send'){
  let q=new URLSearchParams({client_id,redirect_uri:redirect,resource,response_type:'code',scope,code_challenge_method:'S256',code_challenge:pkce,state:'test-state'});
  return routeOAuth(req('/oauth/authorize?'+q));
}
async function postJsonRpc(name,access=null){const headers={'content-type':'application/json'};if(access)headers.authorization='Bearer '+access;return entry.fetch(req('/',{method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:{}}})}));}
test('Dynamic client registration explicitly advertises refresh_token',async()=>{
 let c=await reg();assert.deepEqual(c.grant_types,['authorization_code','refresh_token']);
});
test('Consent metadata offers Gmail-specific scope without changing existing read scope',async()=>{
 const r=await routeOAuth(req('/.well-known/oauth-authorization-server'));const m=await r.json();assert.ok(m.scopes_supported.includes('avior:gmail-send'));assert.ok(m.scopes_supported.includes('avior:read'));
});
test('Consent requests exactly Google identity + SEND + READONLY, no MODIFY or DELETE',async()=>{
 const c=await reg(),r=await begin(c.client_id);assert.equal(r.status,302);
 const google=new URL(r.headers.get('location'));
 for(const scope of googleScopes)assert.ok(google.searchParams.get('scope').includes(scope));
 assert.ok(!google.searchParams.get('scope').includes('gmail.modify'));
 assert.ok(!google.searchParams.get('scope').includes('https://mail.google.com/'));
 assert.equal(google.searchParams.get('access_type'),'online');
});
test('Consent proof advertises distinct Gmail scope and never sends',async()=>{
 const r=await postJsonRpc('avior_gmail_consent_proof');assert.equal(r.status,401);assert.match(r.headers.get('www-authenticate'),/scope="avior:read avior:gmail-send"/);
 const status=await postJsonRpc('avior_gmail_status');assert.equal(status.status,200);
 const data=await status.json();let info=JSON.parse(data.result.content[0].text);assert.equal(info.gmail_send_enabled,false);assert.equal(info.consent_only,true);
});
test('Google consent cannot substitute for read-only ChatGPT authorization',async()=>{
 const c=await reg(),r=await begin(c.client_id);assert.equal(r.status,302);
 const untrusted=await begin(c.client_id,'avior:write');assert.equal(untrusted.status,400);
});
test('No Gmail operation can be invoked: tool listing has only consent proof/status',async()=>{
 const r=await entry.fetch(req('/',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:10,method:'tools/list',params:{}})}));
 const data=await r.json(), tools=data.result.tools;
 assert.ok(tools.some(x=>x.name==='avior_gmail_consent_proof'));
 assert.ok(!tools.some(x=>/avior_gmail_send|avior_gmail_send_request|gmail_messages_send/.test(x.name)));
 const proof=tools.find(x=>x.name==='avior_gmail_consent_proof');assert.deepEqual(proof.securitySchemes[0].scopes,['avior:read','avior:gmail-send']);
});