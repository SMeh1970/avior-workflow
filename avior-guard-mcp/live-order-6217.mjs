import {createHash} from 'node:crypto';

/** Fixed, independently-read sources only. This loader never changes Sheets. */
export const TRUSTED_6217 = Object.freeze({
  registryId: '17Gc-ajR9cN_HmAIT60HavB2tfs4JYNWPtypprC5PG_w',
  orderId: '18OccLfQaqDZb2JdaHjP1k64HIbKs9GztkYvmi7scSMY',
  registryRange: "'Заявки'!A1:D20",
  orderRange: "'1. Заявка 6217'!A1:F25"
});
const deny = code => {const e = Error(code);e.code = code;throw e;};
const string = x => typeof x === 'string' && Boolean(x.trim());
const cell = x => String(x ?? '').trim();

/** Caller must pass an authenticated service-account reader; it receives only fixed source IDs and ranges. */
export async function loadVerifiedOrder6217(readValues) {
  if(typeof readValues !== 'function') deny('LIVE_READER_MISSING');
  const [registry, sheet] = await Promise.all([
    readValues(TRUSTED_6217.registryId, TRUSTED_6217.registryRange),
    readValues(TRUSTED_6217.orderId, TRUSTED_6217.orderRange)
  ]);
  if(!Array.isArray(registry?.values) || !Array.isArray(sheet?.values)) deny('LIVE_SOURCE_UNAVAILABLE');
  const main = registry.values;
  if(main[0]?.[0] !== 'Заявка' || main[0]?.[3] !== 'Рабочая таблица') deny('REGISTRY_HEADER_CHANGED');
  const matches = main.slice(1).filter(x => cell(x?.[0]) === '6217');
  if(matches.length !== 1 || cell(matches[0]?.[3]) !== 'Заявка 6217') deny('REGISTRY_LINK_INVALID');
  const rows = sheet.values;
  if(rows[0]?.[0] !== 'Заявка №6217' || !cell(rows[0]?.[1]) ||
      rows[4]?.[0] !== 'ID' || rows[4]?.[1] !== 'Наименование по заявке' ||
      rows[4]?.[2] !== 'Количество' || rows[4]?.[3] !== 'Ед.') deny('ORDER_HEADER_CHANGED');
  const products = rows.slice(5,15);
  // Check the full bounded source window, not just ten rows; fail if extra item appears.
  if(products.length !== 10 || rows.slice(15).some(x=>x.slice(0,4).some(y=>cell(y)!==''))) deny('ORDER_ITEM_COUNT_CHANGED');
  const seen = new Set();
  const positions = products.map(row => {
    const id = cell(row?.[0]);
    if(!/^\d{5}$/.test(id)||seen.has(id)||!string(row?.[1])||
       typeof row?.[2] !== 'number'||!Number.isFinite(row[2])||row[2]<=0||
       !string(row?.[3])||!Number.isSafeInteger(Number(id))) deny('ORDER_ITEM_INVALID');
    seen.add(id);
    return {number:Number(id),name:row[1].trim(),quantity:row[2],unit:row[3].trim()};
  });
  const relevant = {registry:matches[0].slice(0,4),heading:rows.slice(0,5),positions};
  const digest = createHash('sha256').update(JSON.stringify(relevant)).digest('hex');
  return {
    isVerified:true,
    sourceId:'SHEETS_REGISTRY_AND_ORDER_6217_SHA256_'+digest,
    orderId:'6217', positions,
    deliveryAddress:cell(rows[1]?.[1]),
    sourceFingerprint:digest
  };
}

/** Read bounded ranges only. The Google bearer is a service-account token, never returned to ChatGPT. */
export function makeGoogleSheetsReader({getToken,fetcher=fetch}) {
  if(typeof getToken!=='function'||typeof fetcher!=='function')deny('GOOGLE_READER_NOT_CONFIGURED');
  return async (id,range)=>{
    const permitted = (id===TRUSTED_6217.registryId&&range===TRUSTED_6217.registryRange)||
                      (id===TRUSTED_6217.orderId&&range===TRUSTED_6217.orderRange);
    if(!permitted) deny('UNTRUSTED_SOURCE_REQUEST');
    const token=await getToken();
    if(typeof token!=='string'||!token) deny('GOOGLE_TOKEN_UNAVAILABLE');
    const url='https://sheets.googleapis.com/v4/spreadsheets/'+id+'/values/'+encodeURIComponent(range)+'?valueRenderOption=UNFORMATTED_VALUE';
    const response=await fetcher(url,{method:'GET',headers:{authorization:'Bearer '+token,accept:'application/json'}});
    if(!response.ok) deny('LIVE_GOOGLE_SHEETS_HTTP_'+response.status);
    return response.json();
  };
}