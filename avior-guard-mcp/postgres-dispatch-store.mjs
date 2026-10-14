/**
 * Persistence adapter for AVIOR Guard's Postgres DB (avior_guard).
 * Requires a parameterized SQL client implementing `query(sql, params)`.
 * Neon injects DATABASE_URL at runtime, but the SQL client must be packaged and
 * tested before enabling the adapter on the live function.
 */
const keyValid = x => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x);
export function postgresDispatchStore(db) {
  if(typeof db?.query !== 'function') throw Error('POSTGRES_DRIVER_REQUIRED');
  return {
    async claim({operationKey,fingerprint,orderId,recipient,sourceId}) {
      if(!keyValid(operationKey)||!keyValid(fingerprint)||
        !orderId||!recipient||!sourceId) throw Error('DISPATCH_CLAIM_INVALID');
      const query = `INSERT INTO public.avior_mail_dispatch
       (operation_key, fingerprint, order_id, recipient, source_id, state)
       VALUES ($1,$2,$3,$4,$5,'CLAIMED')
       ON CONFLICT (operation_key) DO NOTHING RETURNING operation_key`;
      const result = await db.query(query,[operationKey,fingerprint,orderId,recipient,sourceId]);
      return Array.isArray(result) ? result.length === 1 : Array.isArray(result?.rows) && result.rows.length === 1;
    },
    async finish({operationKey,state,gmailId=null,reason=null}) {
      if(!keyValid(operationKey)||!['VERIFIED','SENT_BUT_UNVERIFIED','UNKNOWN'].includes(state)||
          (gmailId!==null&&(typeof gmailId!=='string'||gmailId.length>200)))throw Error('DISPATCH_FINISH_INVALID');
      const query = `UPDATE public.avior_mail_dispatch SET state=$2, gmail_message_id=COALESCE($3,gmail_message_id),
        error_code=$4, finished_at=now()
        WHERE operation_key=$1
        AND state IN ('CLAIMED','UNKNOWN','SENT_BUT_UNVERIFIED')
        AND NOT (state='UNKNOWN' AND $2='VERIFIED')
        RETURNING operation_key`;
      const result = await db.query(query,[operationKey,state,gmailId,reason]);
      const rows=Array.isArray(result)?result:result?.rows;
      if(rows?.length!==1) throw Error('DISPATCH_FINISH_CONFLICT');
      return true;
    }
  };
}