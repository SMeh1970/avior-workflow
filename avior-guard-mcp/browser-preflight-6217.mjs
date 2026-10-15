import {createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import {prepareSelfTest6217} from './selftest-dispatch-6217.mjs';
import {readPinnedCard} from './browser-selftest-card.mjs';
import {makeHumanReviewUrl} from './human-approval.mjs';

const HOST='https://br-still-wind-b9pzhljq-aviorguard.compute.c-7.eu-central-1.aws.neon.tech';
const CALLBACK=HOST+'/oauth/google/callback';
const ACCOUNT='1043324@gmail.com';
const BUSINESS_ID='OWNER_SINGLE_TEST_6217_20261015';
const PREFIX='pflight1';
const COOKIE='__Host-avior_preflight';
const deny=code=>{const e=Error(code);e.code=code;throw e;};
const nonce=()=>randomBytes(24).toString('base64url');
const b64=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
const noStore={'cache-control':'no-store','referrer-policy':'no-referrer'};
const clearCookie=COOKIE+'=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax';
const failure=(code,status=403)=>new Response(JSON.stringify({status:'BLOCKED',reason:code,emailsSent:0}),{
 status,headers:{...noStore,'content-type':'application/json'}});
const location=(url,cookie)=>new Response(null,{status:302,headers:{...noStore,location:url,...(cookie?{'set-cookie':cookie}:{})}});
function secret(env){const s=env.MCP_AUTH_SIGNING_SECRET;if(typeof s!=='string'||s.length<32)deny('PREFLIGHT_SECRET_MISSING');return s;}
function sign(body,env){return createHmac('sha256',secret(env)).update('AVIOR_PREFLIGHT_6217_V1\n'+body).digest('base64url');}
function pack(data,env){const body=PREFIX+'.'+b64(data);return body+'.'+sign(body,env);}
function unpack(state,env,now){
 if(typeof state!=='string'||state.length>2000)deny('PREFLIGHT_STATE_INVALID');
 const pieces=state.split('.');
 if(pieces.length!==3||pieces[0]!==PREFIX)deny('PREFLIGHT_STATE_INVALID');
 const body=pieces[0]+'.'+pieces[1];
 const a=Buffer.from(pieces[2]),b=Buffer.from(sign(body,env));
 if(a.length!==b.length||!timingSafeEqual(a,b))deny('PREFLIGHT_STATE_INVALID');
 let data;try{data=JSON.parse(Buffer.from(pieces[1],'base64url').toString('utf8'));}
 catch{deny('PREFLIGHT_STATE_INVALID');}
 if(data.v!==1||data.mode!=='READ_ONLY_6217'||!data.nonce||!data.googleNonce||
  !Number.isFinite(data.expires)||data.expires<=now||data.expires-now>480000)
  deny('PREFLIGHT_STATE_EXPIRED');
 return data;
}
function cookie(req){return (req.headers.get('cookie')||'').match(/(?:^|;\s*)__Host-avior_preflight=([^;]+)/)?.[1]||'';}
const scope='openid email https://www.googleapis.com/auth/gmail.readonly';
export async function routeBrowserPreflight6217(req,{env=process.env,fetcher=fetch,now=Date.now,loadOrder}={}){
 const url=new URL(req.url);
 if(req.method==='GET'&&url.pathname==='/selftest/start'){
  try{
   if(!env.GOOGLE_OAUTH_CLIENT_ID||!env.GOOGLE_OAUTH_CLIENT_SECRET||env.MCP_ALLOWED_GOOGLE_EMAIL?.trim().toLowerCase()!==ACCOUNT)
    deny('PREFLIGHT_GOOGLE_NOT_CONFIGURED');
   const browserNonce=nonce(),googleNonce=nonce(),state=pack({v:1,mode:'READ_ONLY_6217',
    nonce:browserNonce,googleNonce,expires:now()+480000},env);
   const google=new URL('https://accounts.google.com/o/oauth2/v2/auth');
   for(const [k,v] of Object.entries({client_id:env.GOOGLE_OAUTH_CLIENT_ID,redirect_uri:CALLBACK,
    response_type:'code',scope,nonce:googleNonce,state,prompt:'select_account consent',access_type:'online'}))
    google.searchParams.set(k,v);
   return location(google.toString(),COOKIE+'='+browserNonce+'; Path=/; Max-Age=480; Secure; HttpOnly; SameSite=Lax');
  }catch(e){return failure(e.code||'PREFLIGHT_UNAVAILABLE',503);}
 }
 if(req.method==='GET'&&url.pathname==='/oauth/google/callback'&&
    String(url.searchParams.get('state')||'').startsWith(PREFIX+'.')){
  try{
   const data=unpack(url.searchParams.get('state'),env,now());
   if(cookie(req)!==data.nonce||!url.searchParams.get('code')||url.searchParams.has('error'))
    deny('PREFLIGHT_GOOGLE_NOT_CONFIRMED');
   const t=await fetcher('https://oauth2.googleapis.com/token',{method:'POST',
    headers:{'content-type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({grant_type:'authorization_code',code:url.searchParams.get('code'),
     client_id:env.GOOGLE_OAUTH_CLIENT_ID,client_secret:env.GOOGLE_OAUTH_CLIENT_SECRET,
     redirect_uri:CALLBACK})});
   if(!t.ok)deny('PREFLIGHT_GOOGLE_EXCHANGE_FAILED');
   const grant=await t.json();
   if(!grant.id_token||typeof grant.access_token!=='string')deny('PREFLIGHT_GRANT_INVALID');
   const scopes=String(grant.scope||'').split(/\s+/);
   if(!scopes.includes('https://www.googleapis.com/auth/gmail.readonly'))
    deny('PREFLIGHT_READ_SCOPE_MISSING');
   const verify=await fetcher('https://oauth2.googleapis.com/tokeninfo?id_token='+encodeURIComponent(grant.id_token));
   if(!verify.ok)deny('PREFLIGHT_ID_TOKEN_INVALID');
   const id=await verify.json();
   if(String(id.email||'').toLowerCase()!==ACCOUNT||String(id.email_verified)!=='true'||
     id.aud!==env.GOOGLE_OAUTH_CLIENT_ID||id.nonce!==data.googleNonce||
     !['accounts.google.com','https://accounts.google.com'].includes(id.iss)||!id.sub)
    deny('PREFLIGHT_WRONG_ACCOUNT');
   if(typeof loadOrder!=='function')deny('PREFLIGHT_LIVE_SOURCE_UNAVAILABLE');
   const card=await readPinnedCard({googleToken:grant.access_token,ownEmail:ACCOUNT,fetcher});
   const prepared=await prepareSelfTest6217({
    loadOrder,provisionalCard:card,ownEmail:ACCOUNT,userMessageId:BUSINESS_ID
   });
   return location(makeHumanReviewUrl({
    plan:prepared.plan,userMessageId:BUSINESS_ID,ownEmail:ACCOUNT,env,now:now()
   }),clearCookie);
  }catch(e){return failure(e.code||e.message||'PREFLIGHT_FAILED');}
 }
 return null;
}
