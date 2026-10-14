import {createHash,createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import {GUARD_GMAIL_SCOPE,googleScopeForGuard,confirmGoogleGrant,encryptGoogleGrant,decryptGoogleGrant} from './gmail-capability.mjs';

// Google-backed OAuth authorization gateway for a read-only test MCP.
// Not production-ready: authorization codes are signed, short-lived, but
// without a durable one-time-use store. All write operations are disabled.
const HOST='https://br-still-wind-b9pzhljq-aviorguard.compute.c-7.eu-central-1.aws.neon.tech';
const RESOURCE=HOST+'/';
const SCOPE='avior:read';
// Refresh works only for the existing read-only grant. Gmail/send grants remain disabled.
const ACCESS_TTL=3600;
const READ_REFRESH_TTL=30*86400;
// User-authorized consent-only pilot. Explicit false disables Gmail consent entirely.
// No Gmail send endpoints are exposed; consent alone cannot send messages.
const GMAIL_OAUTH_ENABLED=process.env.ENABLE_AVIOR_GMAIL_OAUTH!=='false';
const requestedScopes=GMAIL_OAUTH_ENABLED?[SCOPE,GUARD_GMAIL_SCOPE]:[SCOPE];
const now=()=>Math.floor(Date.now()/1000);
const b64=v=>Buffer.from(typeof v==='string'?v:JSON.stringify(v)).toString('base64url');
const json=(obj,status=200,extra={})=>new Response(JSON.stringify(obj),{
 status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...extra}
});
function key(){const k=process.env.MCP_AUTH_SIGNING_SECRET||'';if(k.length<32)throw Error('AUTH_SIGNING_SECRET_MISSING');return k;}
function sig(s){return createHmac('sha256',key()).update(s).digest('base64url');}
function seal(type,obj){const p=type+'.'+b64(obj);return p+'.'+sig(p);}
function unseal(type,s){
 if(typeof s!=='string'||s.length>12000)return null;
 const parts=s.split('.');if(parts.length!==3||parts[0]!==type)return null;
 const msg=parts[0]+'.'+parts[1], expected=Buffer.from(sig(msg));
 const actual=Buffer.from(parts[2]);
 if(expected.length!==actual.length||!timingSafeEqual(expected,actual))return null;
 try{return JSON.parse(Buffer.from(parts[1],'base64url').toString('utf8'));}catch{return null;}
}
function allowedRedirect(v){
 return typeof v==='string'&&(v==='https://chatgpt.com/connector_platform_oauth_redirect'||
 /^https:\/\/chatgpt\.com\/connector\/oauth\/[A-Za-z0-9_-]{8,160}$/.test(v));
}
function client(v){const x=unseal('client',v);return x&&x.exp>now()&&Array.isArray(x.uris)&&x.uris.length&&x.uris.every(allowedRedirect)?x:null;}
const challengeFor=(scope=SCOPE)=>'Bearer resource_metadata="'+HOST+'/.well-known/oauth-protected-resource", scope="'+scope+'"';
const protectedMetadata={resource:RESOURCE,authorization_servers:[HOST],scopes_supported:requestedScopes};
const authMetadata={issuer:HOST,authorization_endpoint:HOST+'/oauth/authorize',
 token_endpoint:HOST+'/oauth/token',registration_endpoint:HOST+'/oauth/register',
 response_types_supported:['code'],grant_types_supported:['authorization_code','refresh_token'],
 code_challenge_methods_supported:['S256'],token_endpoint_auth_methods_supported:['none'],
 scopes_supported:requestedScopes,authorization_response_iss_parameter_supported:true};
export function checkAccess(req,scope=SCOPE){
 const h=req.headers.get('authorization')||'';
 if(!h.startsWith('Bearer '))return false;
 const a=unseal('access',h.slice(7));
 return !!(a&&a.exp>now()&&a.iss===HOST&&a.aud===RESOURCE&&a.scope===scope&&
 a.email===String(process.env.MCP_ALLOWED_GOOGLE_EMAIL||'').trim().toLowerCase()&&a.sub);
}
export function authorizedGmailAccess(req){
 if(!GMAIL_OAUTH_ENABLED||!checkAccess(req,GUARD_GMAIL_SCOPE))return null;
 const bearer=(req.headers.get('authorization')||'').slice(7);
 const access=unseal('access',bearer);
 if(!access?.gmailCapability)return null;
 try{return decryptGoogleGrant(access.gmailCapability,{email:access.email,sub:access.sub},key());}catch{return null;}
}
export function challengeResult(id,scope=SCOPE){
 const challenge=challengeFor(scope);
 return new Response(JSON.stringify({jsonrpc:'2.0',id,result:{
 content:[{type:'text',text:'Authorization required'}],isError:true,
 _meta:{'mcp/www_authenticate':[challenge]}}}),{status:401,headers:{
 'content-type':'application/json','www-authenticate':challenge,'cache-control':'no-store'}});
}
export function enrichTools(list){return list.map(t=>({...t,
 securitySchemes:['avior_guard_status','avior_gmail_status'].includes(t.name)?[{type:'noauth'}]:[{type:'oauth2',scopes:[t.name.startsWith('avior_gmail_')?GUARD_GMAIL_SCOPE:SCOPE]}]}));}
const cookie=v=>'__Host-avior_session='+encodeURIComponent(v)+'; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600';
function cookieRead(req){const a=(req.headers.get('cookie')||'').match(/(?:^|;\s*)__Host-avior_session=([^;]+)/);return a?decodeURIComponent(a[1]):null;}
const signedNonce=()=>b64(randomBytes(24));
function failGoogle(state,msg){
 const r=new URL(state.callback);
 r.searchParams.set('error',msg);r.searchParams.set('state',state.outerState);r.searchParams.set('iss',HOST);
 return new Response(null,{status:302,headers:{location:r.toString(),'cache-control':'no-store'}});
}
export async function routeOAuth(req){
 const u=new URL(req.url),p=u.pathname,method=req.method;
 if(method==='GET'&&p==='/.well-known/oauth-protected-resource')return json(protectedMetadata);
 if(method==='GET'&&(p==='/.well-known/oauth-authorization-server'||p==='/.well-known/openid-configuration'))return json(authMetadata);
 if(method==='POST'&&p==='/oauth/register'){
  let v;try{v=await req.json();}catch{return json({error:'invalid_client_metadata'},400);}
  const uris=v?.redirect_uris;
  if(!Array.isArray(uris)||!uris.length||uris.length>4||!uris.every(allowedRedirect))return json({error:'invalid_redirect_uri'},400);
  if(v.token_endpoint_auth_method&&v.token_endpoint_auth_method!=='none')return json({error:'invalid_client_metadata'},400);
  const id=seal('client',{uris,exp:now()+365*86400,registrationNonce:signedNonce()});
  return json({client_id:id,client_id_issued_at:now(),redirect_uris:uris,
    client_name:'ChatGPT AVIOR Guard',token_endpoint_auth_method:'none',
    response_types:['code'],grant_types:['authorization_code','refresh_token']},201);
 }
 if(method==='GET'&&p==='/oauth/authorize'){
  const q=u.searchParams,id=q.get('client_id'),registered=client(id);
  const callback=q.get('redirect_uri'),resource=q.get('resource'),challenge=q.get('code_challenge');
  if(!registered||!registered.uris.includes(callback)||q.get('response_type')!=='code'||
     q.get('code_challenge_method')!=='S256'||!/^[A-Za-z0-9_-]{43}$/.test(challenge||'')||
     resource!==RESOURCE||!requestedScopes.includes(q.get('scope'))||!q.get('state')||q.get('state').length>2000)
    return json({error:'invalid_request'},400);
  if(!process.env.GOOGLE_OAUTH_CLIENT_ID||!process.env.GOOGLE_OAUTH_CLIENT_SECRET||
     !process.env.MCP_ALLOWED_GOOGLE_EMAIL)return json({error:'google_oauth_not_configured'},503);
  const nonce=signedNonce(),googleNonce=signedNonce();
  const state=seal('state',{id,callback,resource,challenge,outerState:q.get('state'),nonce,googleNonce,requestScope:q.get('scope'),exp:now()+480});
  const google=new URL('https://accounts.google.com/o/oauth2/v2/auth');
  google.searchParams.set('client_id',process.env.GOOGLE_OAUTH_CLIENT_ID);
  google.searchParams.set('redirect_uri',HOST+'/oauth/google/callback');
  google.searchParams.set('response_type','code');
  google.searchParams.set('scope',q.get('scope')===GUARD_GMAIL_SCOPE?googleScopeForGuard(GUARD_GMAIL_SCOPE):'openid email');
  google.searchParams.set('access_type','online');
  google.searchParams.set('include_granted_scopes','false');
  google.searchParams.set('nonce',googleNonce);google.searchParams.set('state',state);
  google.searchParams.set('prompt',q.get('scope')===GUARD_GMAIL_SCOPE?'select_account consent':'select_account');
  return new Response(null,{status:302,headers:{location:google.toString(),'set-cookie':cookie(nonce),'cache-control':'no-store'}});
 }
 if(method==='GET'&&p==='/oauth/google/callback'){
  const s=unseal('state',u.searchParams.get('state'));
  if(!s||s.exp<=now()||!cookieRead(req)||cookieRead(req)!==s.nonce||!client(s.id))return json({error:'invalid_google_oauth_state'},400);
  if(u.searchParams.has('error'))return failGoogle(s,'access_denied');
  const code=u.searchParams.get('code');if(!code)return json({error:'google_code_missing'},400);
  let account,googleGrant;
  try{
   const resp=await fetch('https://oauth2.googleapis.com/token',{method:'POST',
    headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({
     grant_type:'authorization_code',code,
     client_id:process.env.GOOGLE_OAUTH_CLIENT_ID,client_secret:process.env.GOOGLE_OAUTH_CLIENT_SECRET,
     redirect_uri:HOST+'/oauth/google/callback'})});
   if(!resp.ok)return json({error:'google_token_exchange_failed'},403);
   const t=await resp.json();if(!t.id_token)return json({error:'google_id_token_missing'},403);
   googleGrant=t;
   const verify=await fetch('https://oauth2.googleapis.com/tokeninfo?id_token='+encodeURIComponent(t.id_token));
   if(!verify.ok)return json({error:'google_id_token_invalid'},403);
   account=await verify.json();
  }catch{return json({error:'google_verification_unavailable'},502);}
  const allowed=String(process.env.MCP_ALLOWED_GOOGLE_EMAIL||'').trim().toLowerCase();
  if(!allowed||String(account.email||'').toLowerCase()!==allowed||
     String(account.email_verified)!=='true'||account.aud!==process.env.GOOGLE_OAUTH_CLIENT_ID||
     !['accounts.google.com','https://accounts.google.com'].includes(account.iss)||
     account.nonce!==s.googleNonce||!account.sub)return json({error:'google_account_not_allowed'},403);
  let gmailCapability=null;
  if(s.requestScope===GUARD_GMAIL_SCOPE){
    if(!GMAIL_OAUTH_ENABLED)return json({error:'gmail_oauth_disabled'},403);
    try{confirmGoogleGrant(googleGrant,allowed);gmailCapability=encryptGoogleGrant(googleGrant,
      {email:allowed,sub:account.sub,emailVerified:true},key());}
    catch{return json({error:'gmail_permission_not_granted'},403);}
  }
  const authCode=seal('code',{id:s.id,callback:s.callback,resource:s.resource,challenge:s.challenge,requestScope:s.requestScope,gmailCapability,
    sub:account.sub,email:allowed,exp:now()+60,nonce:signedNonce()});
  const done=new URL(s.callback);done.searchParams.set('code',authCode);
  done.searchParams.set('state',s.outerState);done.searchParams.set('iss',HOST);
  return new Response(null,{status:302,headers:{location:done.toString(),
    'set-cookie':'__Host-avior_session=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0','cache-control':'no-store'}});
 }
 if(method==='POST'&&p==='/oauth/token'){
  let q;try{const text=await req.text();if(text.length>12000)return json({error:'invalid_request'},400);q=new URLSearchParams(text);}catch{return json({error:'invalid_request'},400);}
  const c=unseal('code',q.get('code')),id=q.get('client_id'),verifier=q.get('code_verifier')||'';
  if(q.get('grant_type')==='refresh_token'){
   const grant=unseal('refresh',q.get('refresh_token'));
   if(!grant||grant.exp<=now()||grant.iss!==HOST||grant.aud!==RESOURCE||
     grant.scope!==SCOPE||!client(id)||grant.id!==id||
     !grant.sub||!grant.email||grant.email!==String(process.env.MCP_ALLOWED_GOOGLE_EMAIL||'').trim().toLowerCase()||
     (q.get('resource')&&q.get('resource')!==RESOURCE)||
     (q.get('scope')&&q.get('scope')!==SCOPE))return json({error:'invalid_grant'},400);
   const t=now();
   return json({access_token:seal('access',{iss:HOST,aud:RESOURCE,scope:SCOPE,sub:grant.sub,email:grant.email,iat:t,exp:t+ACCESS_TTL}),
     refresh_token:seal('refresh',{iss:HOST,aud:RESOURCE,id,sub:grant.sub,email:grant.email,scope:SCOPE,iat:t,exp:grant.exp}),
     token_type:'Bearer',scope:SCOPE,expires_in:ACCESS_TTL});
  }
  if(q.get('grant_type')!=='authorization_code'||!c||c.exp<=now()||!client(id)||
     c.id!==id||c.callback!==q.get('redirect_uri')||c.resource!==q.get('resource')||
     !requestedScopes.includes(c.requestScope)||
     !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)||
     createHash('sha256').update(verifier).digest('base64url')!==c.challenge)
    return json({error:'invalid_grant'},400);
  const ttl=c.requestScope===GUARD_GMAIL_SCOPE?600:ACCESS_TTL;
  const issued=now();
  const refresh=c.requestScope===SCOPE?
    {refresh_token:seal('refresh',{iss:HOST,aud:RESOURCE,id,sub:c.sub,email:c.email,scope:SCOPE,iat:issued,exp:issued+READ_REFRESH_TTL})}:{};
  return json({access_token:seal('access',{iss:HOST,aud:RESOURCE,scope:c.requestScope,
    sub:c.sub,email:c.email,gmailCapability:c.gmailCapability,iat:issued,exp:issued+ttl}),token_type:'Bearer',
    scope:c.requestScope,expires_in:ttl,...refresh});
 }
 return null;
}