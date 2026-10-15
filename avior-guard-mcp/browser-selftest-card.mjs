import {createHash} from 'node:crypto';
import {HISTORICAL_CARD_20261007_SHA256} from './selftest-preview-6217.mjs';

const HISTORICAL_SENT_ID='1a115fa4e9cb912a';
const fail=code=>{const e=Error(code);e.code=code;throw e;};
const canon=x=>typeof x==='string'?x.normalize('NFC').replace(/\s+/gu,' ').trim():'';
const fields=['legalName','inn','kpp','ogrn','legalAddress','bankAccount','bankName','bik','correspondentAccount'];
const label=(body,name)=>{
 const lines=body.split(/\r?\n/).map(x=>x.trim());
 const index=lines.findIndex(x=>x===name||x.startsWith(name+' ('));
 if(index<0)fail('HISTORICAL_CARD_LABEL_MISSING');
 return lines.slice(index+1).find(x=>x.length>0)||'';
};
function parts(p){if(!p)return [];return [p,...(p.parts||[]).flatMap(parts)];}
export function parseHistoricalCompanyCard(text){
 if(typeof text!=='string'||text.length>40000||!text.includes('ИНФОРМАЦИОННАЯ КАРТОЧКА'))
  fail('HISTORICAL_EMAIL_UNRECOGNIZED');
 const bankLine=label(text,'БИК, Кор. счет');
 const m=/БИК\s*(\d{9})\s*,\s*к\/с\s*(\d{20})/u.exec(bankLine);
 if(!m)fail('HISTORICAL_BANK_FORMAT_UNRECOGNIZED');
 const card={
  legalName:canon(label(text,'Полное наименование')),
  inn:canon(label(text,'ИНН')),
  kpp:canon(label(text,'КПП')),
  ogrn:canon(label(text,'ОГРН')),
  legalAddress:canon(label(text,'Юридический адрес')),
  bankAccount:canon(label(text,'Расчетный счет')),
  bankName:canon(label(text,'Наименование банка')),
  bik:m[1],correspondentAccount:m[2]
 };
 if(Object.keys(card).length!==fields.length||fields.some(f=>!card[f])||
   createHash('sha256').update(JSON.stringify(card)).digest('hex')!==HISTORICAL_CARD_20261007_SHA256)
  fail('HISTORICAL_CARD_HASH_MISMATCH');
 return card;
}
/** The fixed, pinned message is used ONLY as historical self-test data. */
export async function readPinnedCard({googleToken,ownEmail,fetcher=fetch}){
 if(typeof googleToken!=='string'||googleToken.length<20)fail('GMAIL_TOKEN_REQUIRED');
 const headers={authorization:'Bearer '+googleToken,accept:'application/json'};
 // The caller has already cryptographically verified the Google identity:
 // the browser route checks the OIDC ID token, and MCP uses the verified
 // short-lived bound Gmail capability. Avoid the redundant Gmail profile API.
 if(ownEmail!=='1043324@gmail.com')fail('GOOGLE_MAILBOX_MISMATCH');
 const r=await fetcher('https://gmail.googleapis.com/gmail/v1/users/me/messages/'+HISTORICAL_SENT_ID+'?format=full',{headers});
 if(!r.ok){
   const status=r.status;
   let code='';
   try{
     const x=await r.json();
     const reasons=[x?.error?.status,...(x?.error?.errors||[]).map(e=>e.reason),
       ...(x?.error?.details||[]).map(e=>e.reason)].filter(Boolean);
     code=reasons.find(y=>typeof y==='string'&&/^[A-Za-z_]{3,64}$/.test(y))||'';
   }catch{}
   const hint=/SERVICE_DISABLED|accessNotConfigured|API_KEY_SERVICE_BLOCKED/i.test(code)
     ?'GMAIL_API_DISABLED'
     : /PERMISSION_DENIED|insufficientPermissions|ACCESS_TOKEN_SCOPE_INSUFFICIENT/i.test(code)
       ?'GMAIL_SCOPE_DENIED' : 'GMAIL_SOURCE_HTTP_'+status;
   fail(hint);
 }
 const msg=await r.json();
 if(msg.id!==HISTORICAL_SENT_ID||!msg.labelIds?.includes('SENT'))fail('HISTORICAL_CARD_SOURCE_INVALID');
 const plain=parts(msg.payload).find(x=>x.mimeType==='text/plain'&&x.body?.data);
 if(!plain)fail('HISTORICAL_CARD_TEXT_MISSING');
 const body=Buffer.from(plain.body.data,'base64url').toString('utf8');
 return parseHistoricalCompanyCard(body);
}
