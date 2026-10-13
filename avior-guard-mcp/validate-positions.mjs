/**
 * AVIOR Guard: fail-closed, deterministic line-item validation.
 * IMPORTANT: referenceRows must come from an independently authorized source;
 * never use the proposed output itself as its own source of truth.
 * This module performs NO network requests or writes.
 */
const amount=x=>Math.round((x+Number.EPSILON)*100)/100;
const num=x=>typeof x==='number'&&Number.isFinite(x);
const norm=x=>typeof x==='string'?x.trim().replace(/\s+/g,' '):null;
export function validatePositions(referenceRows,proposedRows){
  const errors=[];
  if(!Array.isArray(referenceRows)||!referenceRows.length||
     !Array.isArray(proposedRows)||proposedRows.length!==referenceRows.length){
    return {approved:false,errors:[{code:'POSITION_COUNT_MISMATCH'}]};
  }
  let grand=0;
  for(let i=0;i<referenceRows.length;i++){
    const a=referenceRows[i],b=proposedRows[i],position=i+1;
    if(!a||!b||!Number.isInteger(a.position)||b.position!==a.position){
      errors.push({position,code:'POSITION_OR_ORDER_MISMATCH'});continue;
    }
    for(const field of ['name','unit']){
      if(!norm(a[field])||norm(a[field])!==norm(b[field]))
        errors.push({position,field,code:'TEXT_MISMATCH'});
    }
    for(const field of ['quantity','price']){
      if(!num(a[field])||!num(b[field])||a[field]!==b[field]||(field==='quantity'&&b[field]<=0)||(field==='price'&&b[field]<0))
        errors.push({position,field,code:'VALUE_MISMATCH'});
    }
    if(num(b.quantity)&&num(b.price)&&num(b.total)){
      const calculated=amount(b.quantity*b.price);
      if(Math.abs(calculated-b.total)>0.009)
        errors.push({position,field:'total',code:'ARITHMETIC_ERROR'});
      if(!num(a.total)||Math.abs(a.total-b.total)>0.009)
        errors.push({position,field:'total',code:'REFERENCE_MISMATCH'});
      grand+=b.total;
    }else errors.push({position,field:'total',code:'INVALID_NUMERIC_FIELD'});
  }
  return {approved:errors.length===0,checked_positions:referenceRows.length,total:amount(grand),errors};
}
