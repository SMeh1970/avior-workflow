import { createSign } from 'node:crypto';
import {routeOAuth,checkAccess,challengeResult,enrichTools,authorizedGmailAccess} from './oauth.mjs';
import {GUARD_GMAIL_SCOPE} from './gmail-capability.mjs';

/* AVIOR Guard: deliberately narrow, fail-closed Google Sheets pilot.
 * The service account can access ONLY a user-shared test copy.
 * No caller can supply spreadsheet ID, tab, operation, or target address.
 * All allowed modifications are idempotent and confined to E3 and M20.
 */
const ID = '1hnvicvEzBlX4mL-cufbkuz35MSUXiXZq3z6as3RBPIA';
const TAB = '4. План-счёт';
const EXPECTED = Object.freeze({ product: 'Gigant Дальномер 80 м GNT-80', unit: 'шт', quantity: 5, price: 3648, sum: 18240 });
const MARKER = 'ТЕСТ АВИОР: разрешённая операция выполнена через MCP-контроллер. Рабочие документы не изменены.';
const JWT_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const BASE = `https://sheets.googleapis.com/v4/spreadsheets/${ID}`;
const proto = '2025-03-26';
const WRITE_ENABLED = false;
let tokenCache = null;

function output(obj, status = 200) { return new Response(JSON.stringify(obj), {status, headers: {'content-type':'application/json; charset=utf-8', 'cache-control':'no-store', 'access-control-allow-origin':'https://chatgpt.com'}}); }
function b64url(input) { return Buffer.from(input).toString('base64url'); }
function credential() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  let c;
  try { c = JSON.parse(raw); } catch { throw Error('GOOGLE_CREDENTIALS_MALFORMED'); }
  if (c.type !== 'service_account' || !String(c.client_email||'').endsWith('.iam.gserviceaccount.com') || !String(c.private_key||'').includes('PRIVATE KEY')) throw Error('GOOGLE_CREDENTIALS_INVALID');
  return c;
}
async function googleToken() {
  if (tokenCache && tokenCache.exp > Date.now() + 60000) return tokenCache.token;
  const c = credential(); if (!c) throw Error('GOOGLE_CREDENTIALS_NOT_CONFIGURED');
  const now = Math.floor(Date.now()/1000);
  const head = b64url(JSON.stringify({alg:'RS256',typ:'JWT'}));
  const payload = b64url(JSON.stringify({iss:c.client_email,scope:JWT_SCOPE,aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3500}));
  const toSign = `${head}.${payload}`;
  const signer = createSign('RSA-SHA256'); signer.update(toSign); signer.end();
  const jwt = `${toSign}.${signer.sign(c.private_key).toString('base64url')}`;
  const resp = await fetch('https://oauth2.googleapis.com/token', {method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:jwt})});
  if (!resp.ok) throw Error(`GOOGLE_TOKEN_HTTP_${resp.status}`);
  const data = await resp.json(); if (!data.access_token) throw Error('GOOGLE_TOKEN_EMPTY');
  tokenCache = {token:data.access_token, exp:Date.now() + Math.min(3400, Number(data.expires_in)||3000)*1000};
  return tokenCache.token;
}
async function google(method, path, body) {
  const bearer = await googleToken();
  const r = await fetch(`${BASE}${path}`, {method, headers:{authorization:`Bearer ${bearer}`,'content-type':'application/json'}, ...(body ? {body:JSON.stringify(body)} : {})});
  if (!r.ok) throw Error(`GOOGLE_SHEETS_HTTP_${r.status}`);
  return r.json();
}
function sourceIsValid(row) {
  return Array.isArray(row) && row[0] === EXPECTED.product && row[1] === EXPECTED.unit && Number(row[2]) === EXPECTED.quantity && Number(row[3]) === EXPECTED.price && Number(row[4]) === EXPECTED.sum;
}
async function auditFullQuote() {
  const range=encodeURIComponent("'"+TAB+"'!A2:F14");
  const result=await google('GET', '/values/'+range+'?valueRenderOption=UNFORMATTED_VALUE');
  const rows=result.values||[];
  if(rows.length!==13)return false;
  let sum=0;
  for(let i=0;i<12;i++){
    const row=rows[i]||[];
    const quantity=row[3],price=row[4],total=row[5];
    if(row[0]!==i+1||typeof row[1]!=='string'||!row[1].trim()||
      typeof row[2]!=='string'||!row[2].trim()||
      !Number.isFinite(quantity)||quantity<=0||!Number.isFinite(price)||price<0||
      !Number.isFinite(total)||Math.abs(Math.round(quantity*price*100)/100-total)>0.011)return false;
    sum+=total;
  }
  return Math.abs(Math.round(sum*100)/100-(rows[12]?.[5]??NaN))<=0.011;
}
async function verifyReference() {
  const range = encodeURIComponent(`'${TAB}'!B3:F3`);
  const data = await google('GET', `/values/${range}?valueRenderOption=UNFORMATTED_VALUE`);
  const matches = sourceIsValid((data.values||[])[0]) && await auditFullQuote();
  return {source_verified: matches, source_id: 'TEST_COPY_5799', row: 3, allowed_price: matches ? EXPECTED.price : null};
}
function checkOperation(cell, value) {
  if (cell !== 'E3') return {allowed:false, reason:'ONLY_TEST_COPY_E3_IS_ALLOWED'};
  if (typeof value !== 'number' || !Number.isFinite(value)) return {allowed:false, reason:'NUMBER_REQUIRED'};
  if (value !== EXPECTED.price) return {allowed:false, reason:'PRICE_MISMATCH_WITH_VERIFIED_REFERENCE'};
  return {allowed:true};
}
async function callTool(name, args, request) {
  if(name==='avior_gmail_consent_proof'){
    const grant=authorizedGmailAccess(request);
    return grant?{status:'GOOGLE_CONSENT_CONFIRMED',account_verified:true,token_expires_at:grant.expiresAt,gmail_send_enabled:false,emails_sent:0}:{status:'BLOCKED',reason:'GOOGLE_GMAIL_CONSENT_NOT_VERIFIED',gmail_send_enabled:false};
  }
  if (name === 'avior_gmail_status') return {connected:true,google_oauth_for_gmail_enabled:process.env.ENABLE_AVIOR_GMAIL_OAUTH!=='false',gmail_send_enabled:false,
  gmail_send_block_reason:'SEND_PIPELINE_AND_IDEMPOTENCY_NOT_VERIFIED',consent_only:true,production_writes_enabled:false};
  if (name === 'avior_guard_status') {
    const configured = Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    const status = {connected:true, google_credentials_configured:configured, google_write_scoped_to:'TEST_COPY_5799', source_verified:false, google_read_test:'NOT_CONFIGURED', production_writes_enabled:false, gmail_enabled:false};
    if (configured) {
      try {const verified=await verifyReference(); status.source_verified=verified.source_verified; status.google_read_test=verified.source_verified?'PASS':'REFERENCE_MISMATCH';}
      catch (e) {status.google_read_test='ERROR'; status.google_read_error=String(e.message||'Google request failed').slice(0,120);}
    }
    return status;
  }
  if (name === 'avior_verify_5799') {
    if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) return {verified:false, reason:'GOOGLE_CREDENTIALS_NOT_CONFIGURED'};
    const r=await verifyReference(); return {verified:r.source_verified, reference:r};
  }
  if (name === 'avior_try_5799_change') {
    const c=checkOperation(args?.cell,args?.new_value);
    if (!c.allowed) return {status:'BLOCKED', reason:c.reason, writes_performed:0};
    if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) return {status:'BLOCKED', reason:'GOOGLE_CREDENTIALS_NOT_CONFIGURED', writes_performed:0};
    if (!WRITE_ENABLED) return {status:'BLOCKED', reason:'PILOT_WRITES_DISABLED', writes_performed:0};
    const trusted=await verifyReference();
    if (!trusted.source_verified) return {status:'BLOCKED', reason:'REFERENCE_CHECK_FAILED', writes_performed:0};
    // Only two fixed cells of a fixed disposable test workbook; untrusted args never reach API.
    await google('POST','/values:batchUpdate',{valueInputOption:'RAW',data:[{range:`'${TAB}'!E3`,values:[[EXPECTED.price]]},{range:`'${TAB}'!M20`,values:[[MARKER]]}]});
    const after=await verifyReference();
    const audit=await google('GET', `/values/${encodeURIComponent(`'${TAB}'!M20`)}?valueRenderOption=FORMATTED_VALUE`);
    const auditOk=audit.values?.[0]?.[0]===MARKER;
    return after.source_verified && auditOk ? {status:'VERIFIED', allowed:true, writes_performed:2, source:'TEST_COPY_5799', changed_cells:['E3 (same value)','M20 (test marker)']} : {status:'FAILED_READBACK', allowed:false, requires_manual_review:true};
  }
  throw Error('UNKNOWN_TOOL');
}
const tools = [
  {name:'avior_gmail_status',description:'Read-only Gmail consent integration status; NEVER sends mail.',inputSchema:{type:'object',properties:{},additionalProperties:false}},
  {name:'avior_gmail_consent_proof',description:'Request Google Gmail consent for AVIOR Guard and report whether it was authorized. Does not send, draft, edit, or read user emails.',inputSchema:{type:'object',properties:{},additionalProperties:false}},
  {name:'avior_guard_status',description:'Diagnostic status for AVIOR Guard; no private data returned.',inputSchema:{type:'object',properties:{},additionalProperties:false}},
  {name:'avior_verify_5799',description:'Validate the actual Gigant distance meter row in the exact protected test COPY of purchase request 5799. Returns only boolean match, not private contents.',inputSchema:{type:'object',properties:{},additionalProperties:false}},
  {name:'avior_try_5799_change',description:'Safely test a proposed price change: rejects any incorrect price, wrong cell, and any production writes. When Google credentials and pilot enable flag are set, writes only fixed unchanged price E3 and diagnostic marker M20 in TEST COPY.',inputSchema:{type:'object',properties:{cell:{type:'string',enum:['E3']},new_value:{type:'number'}},required:['cell','new_value'],additionalProperties:false}}
];
function response(id,result){return output({jsonrpc:'2.0',id,result});}
function err(id,code,message){return output({jsonrpc:'2.0',id,error:{code,message}});}
export default {async fetch(req) {
  const authRoute=await routeOAuth(req);if(authRoute)return authRoute;
  const url=new URL(req.url);
  if(req.method==='GET') return output({service:'AVIOR Guard',mode:'scoped-pilot',google_connected:Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_JSON),production_writes_enabled:false,gmail_enabled:false,gmail_consent_staged:true});
  if(req.method!=='POST') return output({error:'Method Not Allowed'},405);
  if(Number(req.headers.get('content-length')||0)>16384)return output({error:'Request too large'},413);
  let q; try{q=await req.json();}catch{return output({error:'Bad JSON'},400);}
  if(q?.jsonrpc!=='2.0'||typeof q.method!=='string')return err(q?.id??null,-32600,'Invalid request');
  const id=q.id??null;
  if(q.method==='initialize')return response(id,{protocolVersion:proto,capabilities:{tools:{}},serverInfo:{name:'AVIOR Guard Pilot',version:'0.4.2-gmail-consent-only-no-send'}});
  if(q.method==='notifications/initialized')return new Response(null,{status:202});
  if(q.method==='ping')return response(id,{});
  if(q.method==='tools/list')return response(id,{tools:enrichTools(tools)});
  if(q.method==='tools/call'){
    if(!['avior_guard_status','avior_gmail_status'].includes(q.params?.name)){
      const scope=q.params?.name==='avior_gmail_consent_proof'?GUARD_GMAIL_SCOPE:'avior:read';
      if(!checkAccess(req,scope))return challengeResult(id,scope);
    }
    if(!tools.some(t=>t.name===q.params?.name))return err(id,-32601,'Unknown tool');
    try{const result=await callTool(q.params?.name,q.params?.arguments||{},req);return response(id,{content:[{type:'text',text:JSON.stringify(result)}],isError:result.status==='FAILED_READBACK'});}catch(e){return response(id,{content:[{type:'text',text:JSON.stringify({status:'ERROR',reason:String(e.message||'INTERNAL_ERROR'),writes_verified:false})}],isError:true});}
  }
  return err(id,-32601,'Method not found');
}};