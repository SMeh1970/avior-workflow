import {createHash,randomBytes} from 'node:crypto';

const denied=code=>{const e=new Error(code);e.code=code;throw e;};
const clean=str=>typeof str==='string'&&str.length>0&&!/[\r\n\x00-\x1f\x7f]/.test(str);
const address=x=>clean(x)&&/^[^\s@<>]+@[^\s@<>]+\.[A-Za-z]{2,}$/.test(x);
const hash=x=>createHash('sha256').update(x).digest('hex');
const b64=x=>Buffer.from(x).toString('base64').replace(/.{76}/g,'$&\r\n');
const encodedSubject=s=>'=?UTF-8?B?'+Buffer.from(s,'utf8').toString('base64')+'?=';
const canonLine=s=>String(s).replace(/\r\n/g,'\n').replace(/\r/g,'\n').replace(/\n/g,'\r\n');
function assertExactMessage(message,files=[]){
  if(!message||!Array.isArray(message.to)||message.to.length!==1||!address(message.to[0])||
    (message.cc||[]).length||(message.bcc||[]).length||!clean(message.subject)||
    typeof message.body!=='string'||!message.body.trim()||!Array.isArray(message.attachments)||!Array.isArray(files))denied('EMAIL_NOT_APPROVED');
  if(message.attachments.length!==files.length)denied('ATTACHMENTS_CHANGED');
  for(const desc of message.attachments){
    if(!clean(desc.filename)||!/^\w[^/\\]*\.[A-Za-z0-9]+$/.test(desc.filename)||!/^[0-9a-f]{64}$/.test(desc.sha256))denied('ATTACHMENT_INVALID');
    const file=files.find(f=>f.filename===desc.filename);
    if(!file||!(Buffer.isBuffer(file.bytes)||file.bytes instanceof Uint8Array)||hash(file.bytes)!==desc.sha256)denied('ATTACHMENT_HASH_MISMATCH');
  }
}
export function makeGmailRaw(message,files=[]){
  assertExactMessage(message,files);
  const prefix=['To: '+message.to[0],'Subject: '+encodedSubject(message.subject),'MIME-Version: 1.0'];
  const text=['Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: base64','',''+b64(canonLine(message.body))].join('\r\n');
  if(!files.length)return Buffer.from([...prefix,...text.split('\r\n')].join('\r\n'),'utf8').toString('base64url');
  const boundary='avior-'+randomBytes(18).toString('hex');
  const parts=[...prefix,'Content-Type: multipart/mixed; boundary="'+boundary+'"','','--'+boundary,text];
  for(const f of files){
    parts.push('--'+boundary,'Content-Type: application/octet-stream; name="'+f.filename+'"',
      'Content-Disposition: attachment; filename="'+f.filename+'"','Content-Transfer-Encoding: base64','',b64(f.bytes));
  }
  parts.push('--'+boundary+'--','');return Buffer.from(parts.join('\r\n'),'utf8').toString('base64url');
}
const norm=x=>String(x||'').trim().toLowerCase();
const headersOf=m=>Object.fromEntries((m?.payload?.headers||[]).map(x=>[norm(x.name),x.value]));
function decodeHeader(v){const m=String(v||'').match(/^=\?UTF-8\?B\?([^?]+)\?=$/i);return m?Buffer.from(m[1],'base64').toString('utf8'):String(v||'');}
function getBodyParts(payload){if(!payload)return [];
  return [payload,...(payload.parts||[]).flatMap(getBodyParts)];
}
async function api(fetcher,token,path,method='GET',body){
 const result=await fetcher('https://gmail.googleapis.com/gmail/v1/users/me/'+path,{method,
   headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',Accept:'application/json'},
   ...(body?{body:JSON.stringify(body)}:{})});
 if(!result.ok)denied('GMAIL_API_HTTP_'+result.status);
 return result.json();
}
/** Called ONLY from a separately authorized MCP tool after the strict guard and explicit approval. */
export function authorizedGmailTransport({fetcher=fetch,googleToken,verifiedAccount,enabled=false,allowedRecipient}){
 if(!enabled)denied('GMAIL_SEND_DISABLED');
 if(typeof fetcher!=='function'||typeof googleToken!=='string'||googleToken.length<20||
    !address(verifiedAccount)||!address(allowedRecipient))denied('GMAIL_AUTH_INVALID');
 let intended;
 return {
   async send(message){
     if(norm(message?.to?.[0])!==norm(allowedRecipient))denied('RECIPIENT_NOT_AUTHORIZED');
     if(message?.attachments?.length)denied('ATTACHMENTS_SEND_REQUIRES_EXTRA_VALIDATION');
     // The supplier-request guard has already derived and approved every message field.
     const raw=makeGmailRaw(message,[]);
     const user=await api(fetcher,googleToken,'profile');
     if(norm(user.emailAddress)!==norm(verifiedAccount))denied('GOOGLE_ACCOUNT_MISMATCH');
     // IMPORTANT: caller must prevent replay with durable idempotency before calling this transport.
     const result=await api(fetcher,googleToken,'messages/send','POST',{raw});
     if(!result.id)denied('GMAIL_SEND_UNCONFIRMED');
     intended=message;return {messageId:result.id};
   },
   async readSent(messageId){
     if(!intended||!clean(messageId))denied('SENT_READBACK_UNAVAILABLE');
     const result=await api(fetcher,googleToken,'messages/'+encodeURIComponent(messageId)+'?format=full');
     if(!result.labelIds?.includes('SENT'))denied('NOT_IN_SENT');
     const h=headersOf(result),parts=getBodyParts(result.payload);
     const text=parts.find(p=>p.mimeType==='text/plain'&&p.body?.data);
     const body=text?Buffer.from(text.body.data,'base64url').toString('utf8').replace(/\r\n/g,'\n'):'';
     const files=parts.filter(p=>p.filename);
     return {messageId:result.id,to:[h.to],cc:h.cc?[h.cc]:[],bcc:h.bcc?[h.bcc]:[],
       subject:decodeHeader(h.subject),body,attachments:files.map(f=>({filename:f.filename}))};
   }
 };
}