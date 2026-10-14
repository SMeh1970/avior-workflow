import {createHash} from 'node:crypto';
// AVIOR-OPS-001. Fail-closed guard for a supplier RFQ. This module DOES NOT intercept
// the built-in ChatGPT Gmail connector. Gmail send/read adapters must be wired to it.
const fail = code => {const e=new Error(code); e.code=code; throw e;};
const hash = value => createHash('sha256').update(value).digest('hex');
const canon = value => String(value).normalize('NFC').replace(/\s+/gu,' ').trim();
const present = value => typeof value==='string' && !!canon(value) && !/[\u0000-\u001f\u007f]/.test(value);
const mail = x => /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/.test(x||'') ? x.toLowerCase() : fail('INVALID_EMAIL');
const fields = {legalName:'Полное наименование',inn:'ИНН',kpp:'КПП',ogrn:'ОГРН',legalAddress:'Юридический адрес',bankAccount:'Расчётный счёт',bankName:'Банк',bik:'БИК',correspondentAccount:'Корреспондентский счёт'};
export const digestAttachment = bytes => hash(bytes);
function companyCard(card){
 if(card?.isVerified!==true||!present(card.verifiedSource))fail('COMPANY_SOURCE_UNVERIFIED');
 for(const key of Object.keys(fields))if(!present(card[key]))fail('COMPANY_MISSING_'+key.toUpperCase());
 if(!canon(card.legalName).startsWith('Общество с ограниченной ответственностью '))fail('COMPANY_LEGAL_NAME_INCOMPLETE');
 for(const [key,len] of [['inn',10],['kpp',9],['ogrn',13],['bankAccount',20],['bik',9],['correspondentAccount',20]])
   if(!new RegExp('^\\d{'+len+'}$').test(card[key]))fail('COMPANY_INVALID_'+key.toUpperCase());
 return Object.keys(fields).map(k=>fields[k]+': '+canon(card[k])).join('\n');
}
function position(p){
 if(!p||!Number.isSafeInteger(p.number)||p.number<1||!present(p.name)||!present(p.unit)||
    typeof p.quantity!=='number'||!Number.isFinite(p.quantity)||p.quantity<=0)fail('POSITION_INVALID');
 return {number:p.number,name:canon(p.name),unit:canon(p.unit),quantity:p.quantity};
}
function positionsFor(intent,order){
 if(order?.isVerified!==true||!present(order.sourceId)||!present(order.orderId)||!Array.isArray(order.positions)||!order.positions.length)
   fail('ORDER_SOURCE_UNVERIFIED');
 if(String(intent.orderId)!==String(order.orderId)||!Array.isArray(intent.positions)||!intent.positions.length)fail('ORDER_POSITIONS_MISMATCH');
 const source=order.positions.map(position),selected=intent.positions.map(position).sort((a,b)=>a.number-b.number);
 if(new Set(source.map(x=>x.number)).size!==source.length||new Set(selected.map(x=>x.number)).size!==selected.length)fail('POSITION_DUPLICATED');
 for(const p of selected)if(!source.some(x=>JSON.stringify(x)===JSON.stringify(p)))fail('ORDER_POSITIONS_MISMATCH');
 return selected;
}
function checkRecipient(to,supplier){
 if(supplier?.isVerified!==true||!present(supplier.supplierId)||!Array.isArray(supplier.authorizedEmails)||!supplier.authorizedEmails.length)
   fail('SUPPLIER_DIRECTORY_UNVERIFIED');
 const email=mail(to);
 if(!supplier.authorizedEmails.map(mail).includes(email))fail('RECIPIENT_NOT_IN_DIRECTORY');
 return email;
}
function attachmentManifest(expected,files){
 if(!Array.isArray(expected)||!Array.isArray(files))fail('ATTACHMENTS_NOT_SPECIFIED');
 if(expected.length!==files.length)fail('ATTACHMENTS_MISMATCH');
 const names=new Set();
 return expected.map(item=>{
   if(!present(item.filename)||!present(item.sourceRef)||!/^[a-f0-9]{64}$/.test(item.sha256)||names.has(item.filename))
     fail('ATTACHMENT_MANIFEST_INVALID');
   names.add(item.filename);
   const f=files.find(x=>x.filename===item.filename);
   if(!f||!(Buffer.isBuffer(f.bytes)||f.bytes instanceof Uint8Array)||hash(f.bytes)!==item.sha256)fail('ATTACHMENT_HASH_MISMATCH');
   return {filename:item.filename,sha256:item.sha256};
 });
}
export function prepareSupplierRequest({intent,order,company,supplier,attachments}){
 if(!intent||!present(intent.userMessageId)||!present(intent.orderId))fail('USER_COMMAND_MISSING');
 if(!present(intent.paymentTerms)||!present(intent.deliveryTerms)||!present(intent.requestedVat))fail('REQUEST_TERMS_MISSING');
 if(!present(intent.deliveryAddress)&&intent.deliveryMethod!=='Самовывоз')fail('DELIVERY_UNSPECIFIED');
 const requisites=companyCard(company),positions=positionsFor(intent,order),to=checkRecipient(intent.to,supplier);
 const fileList=attachmentManifest(intent.requiredAttachments,attachments);
 const subject='Заявка №'+order.orderId+' — запрос счёта и наличия — ООО «АВИОР»';
 const productText=positions.map(p=>p.number+'. '+p.name+' — '+p.quantity+' '+p.unit).join('\n');
 const delivery=intent.deliveryMethod==='Самовывоз'?'Самовывоз':canon(intent.deliveryAddress);
 const body=['Добрый день!','','Просим выставить счёт на имеющиеся позиции по заявке №'+order.orderId+':','',productText,'',
   'Доставка: '+delivery,'Условия оплаты: '+canon(intent.paymentTerms),'Условия доставки: '+canon(intent.deliveryTerms),
   'Просим сообщить наличие, цену, '+canon(intent.requestedVat)+', срок поставки и стоимость доставки.',
   'Если предложен аналог, просим отдельно указать отличия и дождаться согласования.','','Реквизиты ООО «АВИОР»:',requisites,
   '','С уважением,','ООО «АВИОР»'].join('\n');
 const message={to:[to],cc:[],bcc:[],subject,body,attachments:fileList};
 const provenance={orderId:String(order.orderId),orderSource:order.sourceId,companySource:company.verifiedSource,
   supplierId:supplier.supplierId,userMessageId:intent.userMessageId};
 return {message,provenance,fingerprint:hash(JSON.stringify({message,provenance})),status:'READY_FOR_EXPLICIT_APPROVAL'};
}
export async function executeApprovedSupplierRequest({intent,approval,loadOrder,loadCompany,loadSupplier,attachments,transport}){
 if(typeof loadOrder!=='function'||typeof loadCompany!=='function'||typeof loadSupplier!=='function'||
    typeof transport?.send!=='function'||typeof transport?.readSent!=='function')fail('ADAPTER_MISSING');
 const [order,company,supplier]=await Promise.all([loadOrder(intent.orderId),loadCompany(),loadSupplier(intent.to)]);
 const p=prepareSupplierRequest({intent,order,company,supplier,attachments});
 if(approval?.confirmed!==true||approval.userMessageId!==intent.userMessageId||approval.fingerprint!==p.fingerprint)
   fail('APPROVAL_REQUIRED_OR_STALE');
 const sent=await transport.send({...p.message,attachments});
 if(!sent?.messageId)fail('SEND_UNCONFIRMED');
 try{
   const actual=await transport.readSent(sent.messageId);
   if(actual?.messageId!==sent.messageId||JSON.stringify(actual.to?.map(mail))!==JSON.stringify(p.message.to)||
      (actual.cc||[]).length||(actual.bcc||[]).length||actual.subject!==p.message.subject||
      actual.body!==p.message.body||JSON.stringify(actual.attachments||[])!==JSON.stringify(p.message.attachments))
      fail('SENT_COPY_DIFFERS');
   return {status:'VERIFIED',messageId:sent.messageId,fingerprint:p.fingerprint};
 }catch(e){return {status:'SENT_BUT_UNVERIFIED',messageId:sent.messageId,reason:e.code||'READBACK_FAILED',requiresManualReview:true};}
}