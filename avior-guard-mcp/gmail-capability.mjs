import {createHash,randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';

export const GUARD_GMAIL_SCOPE='avior:gmail-send';
export const GOOGLE_GMAIL_PERMISSIONS=Object.freeze([
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.readonly'
]);
const err=(code)=>{const x=new Error(code);x.code=code;throw x;};
const norm=x=>String(x||'').trim().toLowerCase();
const key=secret=>{
  if(typeof secret!=='string'||secret.length<32)err('CAPABILITY_KEY_UNCONFIGURED');
  return createHash('sha256').update('AVIOR_GMAIL_CAPABILITY_V1\0'+secret).digest();
};
export function googleScopeForGuard(scope){
  if(scope!==GUARD_GMAIL_SCOPE)err('UNSUPPORTED_GUARD_SCOPE');
  return ['openid','email',...GOOGLE_GMAIL_PERMISSIONS].join(' ');
}
/** Google-returned token must explicitly grant BOTH minimal required Gmail scopes. */
export function confirmGoogleGrant(grant,expectedEmail){
  if(!grant||typeof grant.access_token!=='string'||grant.access_token.length<20||
    !Number.isFinite(Number(grant.expires_in))||Number(grant.expires_in)<120)
    err('GOOGLE_GRANT_INVALID');
  const scopes=new Set(String(grant.scope||'').split(/\s+/).filter(Boolean));
  for(const s of GOOGLE_GMAIL_PERMISSIONS)if(!scopes.has(s))err('GOOGLE_SCOPE_MISSING');
  if(!norm(expectedEmail)||!/^\S+@\S+\.\S+$/.test(norm(expectedEmail)))err('ACCOUNT_NOT_VERIFIED');
  return true;
}
/** No refresh token is retained. The Google access token is encrypted before entering MCP tokens. */
export function encryptGoogleGrant(grant,identity,secret,now=Date.now()){
  confirmGoogleGrant(grant,identity?.email);
  if(!identity?.sub||!identity?.emailVerified)err('ACCOUNT_NOT_VERIFIED');
  const until=now+Math.min(900,Number(grant.expires_in)-90)*1000;
  const iv=randomBytes(12);const cipher=createCipheriv('aes-256-gcm',key(secret),iv);
  cipher.setAAD(Buffer.from('avior:gmail-send:v1'));
  const payload=JSON.stringify({token:grant.access_token,sub:identity.sub,
    email:norm(identity.email),exp:until});
  const bytes=Buffer.concat([cipher.update(payload,'utf8'),cipher.final()]);
  return ['v1',iv.toString('base64url'),bytes.toString('base64url'),cipher.getAuthTag().toString('base64url')].join('.');
}
export function decryptGoogleGrant(sealed,identity,secret,now=Date.now()){
  if(typeof sealed!=='string'||sealed.length>12000)err('CAPABILITY_MALFORMED');
  const x=sealed.split('.');if(x.length!==4||x[0]!=='v1')err('CAPABILITY_MALFORMED');
  let body;try{
    const dec=createDecipheriv('aes-256-gcm',key(secret),Buffer.from(x[1],'base64url'));
    dec.setAAD(Buffer.from('avior:gmail-send:v1'));dec.setAuthTag(Buffer.from(x[3],'base64url'));
    body=JSON.parse(Buffer.concat([dec.update(Buffer.from(x[2],'base64url')),dec.final()]).toString('utf8'));
  }catch{err('CAPABILITY_INTEGRITY_FAILED');}
  if(body.exp<=now+10000||body.sub!==identity?.sub||body.email!==norm(identity?.email))err('CAPABILITY_EXPIRED_OR_WRONG_ACCOUNT');
  return {access_token:body.token,email:body.email,expiresAt:body.exp};
}