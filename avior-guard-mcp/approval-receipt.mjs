import {createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
const error = code => {const e=new Error(code);e.code=code;throw e};
const label='AVIOR_DISPATCH_APPROVAL_V1';
function secretOk(secret){if(typeof secret!=='string'||secret.length<32)error('APPROVAL_SECRET_MISSING')}
function sign(payload,secret){return createHmac('sha256',secret).update(label+'\n'+payload).digest('base64url')}
/** Called ONLY by a separately user-authorized approval service, NEVER by a ChatGPT-facing public tool. */
export function issueApprovalReceipt(details,secret,now=Date.now()){
 secretOk(secret);
 const {orderId,recipient,fingerprint,userMessageId,mode}=details||{};
 if(!orderId||!recipient||!userMessageId||mode!=='SELF_TEST'||!/^[a-f0-9]{64}$/.test(fingerprint||''))error('APPROVAL_RECEIPT_INVALID');
 const payload=Buffer.from(JSON.stringify({v:1,orderId,recipient:recipient.toLowerCase(),fingerprint,userMessageId,mode,
  issuedAt:now,expiresAt:now+10*60*1000,nonce:randomBytes(16).toString('hex')})).toString('base64url');
 return payload+'.'+sign(payload,secret);
}
export function verifyApprovalReceipt(receipt,expected,secret,now=Date.now()){
 secretOk(secret);
 if(typeof receipt!=='string'||receipt.length>2500)error('APPROVAL_RECEIPT_MISSING');
 const tokens=receipt.split('.');if(tokens.length!==2)error('APPROVAL_RECEIPT_INVALID');
 const [payload,mac]=tokens;
 const a=Buffer.from(sign(payload,secret)),b=Buffer.from(mac);
 if(a.length!==b.length||!timingSafeEqual(a,b))error('APPROVAL_RECEIPT_SIGNATURE_INVALID');
 let data;try{data=JSON.parse(Buffer.from(payload,'base64url').toString('utf8'))}catch{error('APPROVAL_RECEIPT_INVALID')}
 if(data.v!==1||data.mode!=='SELF_TEST'||data.orderId!==expected.orderId||data.userMessageId!==expected.userMessageId||
    data.recipient!==expected.recipient?.toLowerCase()||data.fingerprint!==expected.fingerprint||
    !Number.isFinite(data.expiresAt)||data.expiresAt<=now||data.expiresAt-now>10*60*1000||data.issuedAt>now+10000)
    error('APPROVAL_RECEIPT_SCOPE_OR_TTL_INVALID');
 return true;
}