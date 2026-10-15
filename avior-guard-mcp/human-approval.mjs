import {createHash,createCipheriv,createDecipheriv,createHmac,randomBytes} from 'node:crypto';
import {issueApprovalReceipt} from './approval-receipt.mjs';

const HOST='https://br-still-wind-b9pzhljq-aviorguard.compute.c-7.eu-central-1.aws.neon.tech';
const GOOGLE_CALLBACK=HOST+'/oauth/google/callback';
const PREFIX='hav1';
const deny=code=>{const e=Error(code);e.code=code;throw e;};
const b64=s=>Buffer.from(s).toString('base64url');
const nonce=()=>randomBytes(18).toString('base64url');
const escapeHtml=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const headers={'content-type':'text/html; charset=utf-8','cache-control':'no-store',
  'content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  'x-content-type-options':'nosniff','referrer-policy':'no-referrer'};
const html=(body,status=200,extra={})=>new Response('<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>AVIOR Guard — подтверждение</title></head><body>'+body+'</body></html>',{status,headers:{...headers,...extra}});
const redirect=(url,extra={})=>new Response(null,{status:302,headers:{location:url,'cache-control':'no-store',...extra}});
function root(secret){
 if(typeof secret!=='string'||secret.length<32)deny('HUMAN_APPROVAL_SECRET_MISSING');
 return createHash('sha256').update('AVIOR_HUMAN_REVIEW_V1\0'+secret).digest();
}
export function approvalSecretFromEnv(env=process.env){
 const rootSecret=env.MCP_AUTH_SIGNING_SECRET;
 if(typeof rootSecret!=='string'||rootSecret.length<32)deny('HUMAN_APPROVAL_SECRET_MISSING');
 return createHash('sha256').update('AVIOR_SEPARATE_HUMAN_RECEIPT_V1\0'+rootSecret).digest('hex');
}
function seal(payload,secret){
 const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',root(secret),iv);
 c.setAAD(Buffer.from(PREFIX));
 const data=Buffer.concat([c.update(JSON.stringify(payload),'utf8'),c.final()]);
 return [PREFIX,iv.toString('base64url'),data.toString('base64url'),c.getAuthTag().toString('base64url')].join('.');
}
function open(token,secret,now=Date.now()){
 if(typeof token!=='string'||token.length>12000)deny('REVIEW_TICKET_INVALID');
 const parts=token.split('.');if(parts.length!==4||parts[0]!==PREFIX)deny('REVIEW_TICKET_INVALID');
 let data;
 try{
  const decipher=createDecipheriv('aes-256-gcm',root(secret),Buffer.from(parts[1],'base64url'));
  decipher.setAAD(Buffer.from(PREFIX));decipher.setAuthTag(Buffer.from(parts[3],'base64url'));
  data=JSON.parse(Buffer.concat([decipher.update(Buffer.from(parts[2],'base64url')),decipher.final()]).toString('utf8'));
 }catch{deny('REVIEW_TICKET_INVALID');}
 if(data?.v!==1||data.mode!=='SELF_TEST'||data.orderId!=='6217'||
    !/^[a-f0-9]{64}$/.test(data.fingerprint||'')||
    typeof data.userMessageId!=='string'||!data.userMessageId||
    !Array.isArray(data.to)||data.to.length!==1||data.to[0]!==data.recipient||
    (data.cc||[]).length||(data.bcc||[]).length||(data.attachments||[]).length||
    !String(data.body||'').includes('Реквизиты ООО «АВИОР»:')||
    !Number.isFinite(data.issuedAt)||!Number.isFinite(data.expiresAt)||
    data.expiresAt<=now||data.expiresAt-now>600000||data.issuedAt>now+10000)
    deny('REVIEW_TICKET_EXPIRED_OR_INVALID');
 return data;
}
function signState(data,secret){
 const payload=b64(JSON.stringify(data));
 const input='hreview.'+payload;
 const mac=createHmac('sha256',root(secret)).update(input).digest('base64url');
 return input+'.'+mac;
}
function verifyState(token,secret,now=Date.now()){
 if(typeof token!=='string'||token.length>16000)deny('HUMAN_OAUTH_STATE_INVALID');
 const xs=token.split('.');if(xs.length!==3||xs[0]!=='hreview')deny('HUMAN_OAUTH_STATE_INVALID');
 const a=signState(JSON.parse(Buffer.from(xs[1],'base64url').toString('utf8')),secret);
 // HMAC is verified by exact signed-token comparison; no client data can supply a key.
 if(a!==token)deny('HUMAN_OAUTH_STATE_INVALID');
 const data=JSON.parse(Buffer.from(xs[1],'base64url').toString('utf8'));
 if(!Number.isFinite(data.exp)||data.exp<=now||data.exp-now>480000||!data.nonce||!data.googleNonce)
    deny('HUMAN_OAUTH_STATE_EXPIRED');
 return data;
}
function page(text,body,status=200,extra={}) {
 return html('<h2>'+escapeHtml(text)+'</h2>'+body,status,extra);
}
/** Generate review URL only from a deterministic, server-verified full-order plan. */
export function makeHumanReviewUrl({plan,userMessageId,ownEmail,env=process.env,now=Date.now()}){
 if(plan?.message?.to?.length!==1||plan.message.to[0]!==ownEmail||
    plan.message.cc?.length||plan.message.bcc?.length||plan.message.attachments?.length||
    !/^[a-f0-9]{64}$/.test(plan.fingerprint||'')||typeof userMessageId!=='string')
    deny('REVIEW_PLAN_NOT_SELF_ONLY');
 const payload={v:1,mode:'SELF_TEST',orderId:'6217',fingerprint:plan.fingerprint,
  userMessageId,recipient:ownEmail,to:plan.message.to,
  cc:[],bcc:[],attachments:[],subject:plan.message.subject,body:plan.message.body,
  issuedAt:now,expiresAt:now+600000};
 return HOST+'/selftest/review?t='+encodeURIComponent(seal(payload,env.MCP_AUTH_SIGNING_SECRET));
}
/**
 * Human approval is deliberately OUTSIDE the MCP tools and requires a browser
 * form POST followed by independent Google account authentication.
 * It ISSUES a receipt but NEVER sends mail or changes the DB.
 */
export async function routeHumanReview(req,{env=process.env,fetcher=fetch,now=Date.now}={}){
 const url=new URL(req.url),method=req.method,secret=env.MCP_AUTH_SIGNING_SECRET;
 if(url.pathname==='/selftest/review'&&method==='GET'){
  try{
   const data=open(url.searchParams.get('t'),secret,now());
   const form='<pre style="white-space:pre-wrap">'+escapeHtml('Кому: '+data.recipient+'\nТема: '+data.subject+'\n\n'+data.body)+'</pre>'+
    '<p><strong>Тест только на собственную почту. Поставщикам не отправляется.</strong></p>'+
    '<form method="post" action="/selftest/approve"><input type="hidden" name="ticket" value="'+escapeHtml(url.searchParams.get('t'))+'">'+
    '<button type="submit">Подтвердить именно это тестовое письмо через Google</button></form>';
   return page('Проверка письма ООО «АВИОР» №6217',form);
  }catch(e){return page('Подтверждение недоступно','<p>'+escapeHtml(e.code||'INVALID_TICKET')+'</p>',403);}
 }
 if(url.pathname==='/selftest/approve'&&method==='POST'){
  const origin=req.headers.get('origin');if(origin!==HOST)return page('Запрещено','<p>Неверный Origin</p>',403);
  let form;try{form=new URLSearchParams(await req.text());}catch{return page('Ошибка','',400);}
  const token=form.get('ticket');let data;
  try{data=open(token,secret,now());}catch{return page('Ссылка устарела','',403);}
  if(!env.GOOGLE_OAUTH_CLIENT_ID||!env.GOOGLE_OAUTH_CLIENT_SECRET||!env.MCP_ALLOWED_GOOGLE_EMAIL||
     data.recipient!==env.MCP_ALLOWED_GOOGLE_EMAIL.trim().toLowerCase())
   return page('Авторизация недоступна','',503);
  const proof=nonce(),googleNonce=nonce(),state=signState({
    v:1,ticket:token,nonce:proof,googleNonce,exp:now()+480000
  },secret);
  const google=new URL('https://accounts.google.com/o/oauth2/v2/auth');
  google.searchParams.set('client_id',env.GOOGLE_OAUTH_CLIENT_ID);
  google.searchParams.set('redirect_uri',GOOGLE_CALLBACK);
  google.searchParams.set('response_type','code');
  google.searchParams.set('scope','openid email');
  google.searchParams.set('nonce',googleNonce);google.searchParams.set('state',state);
  google.searchParams.set('prompt','select_account');
  return redirect(google.toString(),{'set-cookie':'__Host-avior_human='+proof+'; Path=/; Max-Age=480; HttpOnly; Secure; SameSite=Lax'});
 }
 if(url.pathname==='/oauth/google/callback'&&method==='GET'&&String(url.searchParams.get('state')||'').startsWith('hreview.')){
  let state;
  try{state=verifyState(url.searchParams.get('state'),secret,now());}
  catch{return page('Ошибка авторизации','<p>Неверный или просроченный запрос</p>',403);}
  const cookie=(req.headers.get('cookie')||'').match(/(?:^|;\s*)__Host-avior_human=([^;]+)/);
  if(!cookie||cookie[1]!==state.nonce||!url.searchParams.get('code')||url.searchParams.get('error'))
   return page('Подтверждение не принято','<p>Google-авторизация не подтверждена</p>',403);
  let ticket;try{ticket=open(state.ticket,secret,now());}catch{return page('Ссылка устарела','',403);}
  let googleToken,identity;
  try{
   const resp=await fetcher('https://oauth2.googleapis.com/token',{method:'POST',
    headers:{'content-type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({grant_type:'authorization_code',code:url.searchParams.get('code'),
      client_id:env.GOOGLE_OAUTH_CLIENT_ID,client_secret:env.GOOGLE_OAUTH_CLIENT_SECRET,
      redirect_uri:GOOGLE_CALLBACK})});
   if(!resp.ok)throw Error('TOKEN_EXCHANGE_FAILED');
   googleToken=await resp.json();if(!googleToken.id_token)throw Error('ID_TOKEN_MISSING');
   const r=await fetcher('https://oauth2.googleapis.com/tokeninfo?id_token='+encodeURIComponent(googleToken.id_token));
   if(!r.ok)throw Error('ID_TOKEN_INVALID');
   identity=await r.json();
  }catch{return page('Google-авторизация не пройдена','',403);}
  if(String(identity.email||'').toLowerCase()!==ticket.recipient||
     String(identity.email_verified)!=='true'||identity.aud!==env.GOOGLE_OAUTH_CLIENT_ID||
     !['accounts.google.com','https://accounts.google.com'].includes(identity.iss)||
     identity.nonce!==state.googleNonce||!identity.sub)
   return page('Неверный Google-аккаунт','',403);
  const receipt=issueApprovalReceipt({orderId:ticket.orderId,recipient:ticket.recipient,
    fingerprint:ticket.fingerprint,userMessageId:ticket.userMessageId,mode:'SELF_TEST'},
    approvalSecretFromEnv(env),now());
  return page('Личное подтверждение получено',
    '<p>Письмо ещё не отправлено. Передайте код подтверждения в чат для отдельной защищённой отправки.</p>'+
    '<textarea readonly rows="7" cols="92">'+escapeHtml(receipt)+'</textarea>'+
    '<p>Кому: '+escapeHtml(ticket.recipient)+'; заявка №6217. Код действует 10 минут.</p>',200,
    {'set-cookie':'__Host-avior_human=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax'});
 }
 return null;
}
