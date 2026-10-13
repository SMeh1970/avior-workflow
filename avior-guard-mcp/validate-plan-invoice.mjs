/** Independent, fail-closed validation of a vetted procurement plan vs an invoice. No IO. */
const norm=v=>typeof v==='string'?v.replace(/\s+/g,' ').trim():null;
const number=v=>typeof v==='number'&&Number.isFinite(v);
const money=v=>Math.round((v+Number.EPSILON)*100)/100;
export function validatePlanInvoice(planRows,invoiceRows){
  const errors=[];
  if(!Array.isArray(planRows)||!planRows.length||!Array.isArray(invoiceRows))
    return {approved:false,positions_checked:0,errors:[{code:'INVALID_SOURCE_OR_INVOICE'}]};
  const source=planRows.filter(r=>r&&Number.isInteger(r.position));
  const proposed=invoiceRows.filter(r=>r&&Number.isInteger(r.position));
  if(source.length!==proposed.length||source.length!==planRows.length||proposed.length!==invoiceRows.length)
    errors.push({code:'ITEM_COUNT_MISMATCH',expected:source.length,actual:proposed.length});
  const n=Math.max(source.length,proposed.length);
  for(let i=0;i<n;i++){
    const a=source[i],b=proposed[i],p=i+1;
    if(!a||!b){errors.push({position:p,code:'MISSING_OR_ADDED_POSITION'});continue;}
    if(a.position!==p||b.position!==p){errors.push({position:p,code:'POSITION_NUMBER_OR_ORDER_MISMATCH'});continue;}
    for(const f of ['name','unit'])if(!norm(a[f])||norm(a[f])!==norm(b[f]))
      errors.push({position:p,field:f,code:'TEXT_MISMATCH'});
    for(const f of ['quantity','price'])if(!number(a[f])||!number(b[f])||
      (f==='quantity'&&(a[f]<=0||b[f]<=0))||(f==='price'&&(a[f]<0||b[f]<0))||a[f]!==b[f])
      errors.push({position:p,field:f,code:'NUMERIC_MISMATCH'});
    if(!number(a.total)||!number(b.total)||Math.abs(money(a.total)-money(b.total))>0.009)
      errors.push({position:p,field:'total',code:'LINE_TOTAL_MISMATCH'});
    if(number(b.quantity)&&number(b.price)&&number(b.total)&&
      Math.abs(money(b.quantity*b.price)-money(b.total))>0.009)
      errors.push({position:p,field:'total',code:'ARITHMETIC_MISMATCH'});
  }
  const referenceTotal=source.reduce((s,r)=>s+(number(r.total)?r.total:0),0);
  const proposedTotal=proposed.reduce((s,r)=>s+(number(r.total)?r.total:0),0);
  if(Math.abs(money(referenceTotal)-money(proposedTotal))>0.009)
    errors.push({code:'DOCUMENT_TOTAL_MISMATCH'});
  return {approved:errors.length===0,positions_checked:n,errors};
}