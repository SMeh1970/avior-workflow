import {createSign} from 'node:crypto';
const ID='1hnvicvEzBlX4mL-cufbkuz35MSUXiXZq3z6as3RBPIA';
const TAB='4. План-счёт';
const MARKER='ТЕСТ АВИОР: разрешённая операция выполнена через MCP-контроллер. Рабочие документы не изменены.';
const EXPECT={product:'Gigant Дальномер 80 м GNT-80',unit:'шт',quantity:5,price:3648,sum:18240};
const WRITE_ENABLED=false; // ALWAYS restore false after temporary test
const BASE='https://sheets.googleapis.com/v4/spreadsheets/'+ID;
const headers={'content-type':'application/json; charset=utf-8','cache-control':'no-store'};
const respond=(o,status=200)=>new Response(JSON.stringify(o),{status,headers});
function cred(){const s=process.env.GOOGLE_SERVICE_ACCOUNT_JSON; if(!s)return null;const j=JSON.parse(s);if(j.type!=='service_account'||j.client_email!=='avior-guard@avior-workflow.iam.gserviceaccount.com'||!j.private_key)throw Error('CREDENTIALS_BAD');return j}
let cached={};
async function token(){if(cached.value&&Date.now()<cached.until)return cached.value;const c=cred();if(!c)throw Error('CREDENTIALS_MISSING');const time=Math.floor(Date.now()/1000),p=JSON.stringify({iss:c.client_email,scope:'https://www.googleapis.com/auth/spreadsheets',aud:'https://oauth2.googleapis.com/token',iat:time,exp:time+3500}),enc=s=>Buffer.from(s).toString('base64url'),pre=enc('{"alg":"RS256","typ":"JWT"}')+'.'+enc(p),sg=createSign('RSA-SHA256');sg.update(pre);sg.end();const jwt=pre+'.'+sg.sign(c.private_key).toString('base64url');const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:jwt})});if(!r.ok)throw Error('TOKEN_HTTP_'+r.status);const t=await r.json();cached={value:t.access_token,until:Date.now()+Math.min(3000,t.expires_in||3000)*1000};return cached.value}
async function sheet(method,path,body){const t=await token();const r=await fetch(BASE+path,{method,headers:{authorization:'Bearer '+t,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});if(!r.ok)throw Error('SHEETS_HTTP_'+r.status);return r.json()}
async function val(range){const r=await sheet('GET','/values/'+encodeURIComponent("'"+TAB+"'!"+range)+'?valueRenderOption=UNFORMATTED_VALUE');return r.values?.[0]||[]}
async function auditTable(){
  const r=await sheet('GET','/values/'+encodeURIComponent("'"+TAB+"'!A2:F14")+'?valueRenderOption=UNFORMATTED_VALUE');
  const data=r.values||[];
  if(data.length!==13)return false;
  let sum=0;
  for(let i=0;i<12;i++){
    const a=data[i]||[],q=a[3],price=a[4],line=a[5];
    if(a[0]!==i+1||typeof a[1]!=='string'||!a[1].trim()||
       typeof a[2]!=='string'||!a[2].trim()||
       !Number.isFinite(q)||q<=0||!Number.isFinite(price)||price<0||
       !Number.isFinite(line)||Math.abs(Math.round(q*price*100)/100-line)>0.011)return false;
    sum+=line;
  }
  return Math.abs(Math.round(sum*100)/100-(data[12]?.[5]??NaN))<=0.011;
}
async function check(){const v=await val('B3:F3');return v[0]===EXPECT.product&&v[1]===EXPECT.unit&&v[2]===EXPECT.quantity&&v[3]===EXPECT.price&&v[4]===EXPECT.sum&&await auditTable()}
const tools=[
{name:'avior_guard_status',description:'Diagnostic status for AVIOR Guard. Real Google read, no private data disclosed.',inputSchema:{type:'object',properties:{},additionalProperties:false}},
{name:'avior_verify_5799',description:'Verify product, unit, quantity, price and sum in test copy 5799, without exposing private data.',inputSchema:{type:'object',properties:{},additionalProperties:false}},
{name:'avior_try_5799_change',description:'Test a proposed price. Only fixed E3=3648 and test marker M20 can be written to TEST COPY 5799, and only when pilot is enabled.',inputSchema:{type:'object',properties:{cell:{type:'string',enum:['E3']},new_value:{type:'number'}},required:['cell','new_value'],additionalProperties:false}}
];
async function call(name,a){
if(name==='avior_guard_status'){let verified=false;if(cred()){try{verified=await check()}catch(e){return {connected:true,google_credentials_configured:true,google_read_test:'ERROR',reason:String(e.message).slice(0,60),production_writes_enabled:false,gmail_enabled:false}}}return {connected:true,google_credentials_configured:!!cred(),source_verified:verified,google_read_test:verified?'PASS':'FAIL',pilot_writes_enabled:WRITE_ENABLED,production_writes_enabled:false,gmail_enabled:false}}
if(name==='avior_verify_5799'){return {verified:await check(),source_id:'TEST_COPY_5799',reference_cell:'E3',expected_price:3648}}
if(name==='avior_try_5799_change'){
if(a?.cell!=='E3'||a?.new_value!==3648)return {status:'BLOCKED',reason:'INVALID_CELL_OR_PRICE',writes_performed:0};
if(!WRITE_ENABLED)return {status:'BLOCKED',reason:'PILOT_WRITES_DISABLED',writes_performed:0};
if(!await check())return {status:'BLOCKED',reason:'REFERENCE_MISMATCH',writes_performed:0};
if((await val('M20'))[0]===MARKER)return {status:'VERIFIED',idempotent:true,writes_performed:0};
const r=await sheet('POST','/values:batchUpdate',{valueInputOption:'RAW',data:[{range:"'"+TAB+"'!E3",values:[[EXPECT.price]]},{range:"'"+TAB+"'!M20",values:[[MARKER]]}]});
const ok=await check()&&(await val('M20'))[0]===MARKER;
return ok?{status:'VERIFIED',writes_performed:2,source_id:'TEST_COPY_5799',changed_cells:['E3 (unchanged value)','M20 (diagnostic marker)']}:{status:'FAILED_READBACK',requires_manual_review:true};
}
throw Error('UNKNOWN_TOOL')}
export default {async fetch(req){
if(req.method==='GET')return respond({service:'AVIOR Guard',production_writes_enabled:false,pilot_writes_enabled:WRITE_ENABLED});
if(req.method!=='POST')return respond({error:'Method not allowed'},405);
if(Number(req.headers.get('content-length')||0)>16000)return respond({error:'Too large'},413);
let q;try{q=await req.json()}catch{return respond({error:'Invalid JSON'},400)}
const id=q.id??null,reply=o=>respond({jsonrpc:'2.0',id,result:o});
if(q.method==='initialize')return reply({protocolVersion:'2025-03-26',capabilities:{tools:{}},serverInfo:{name:'AVIOR Guard',version:'0.3.0'}});
if(q.method==='notifications/initialized')return new Response(null,{status:202});
if(q.method==='ping')return reply({});
if(q.method==='tools/list')return reply({tools});
if(q.method==='tools/call'){if(!tools.some(t=>t.name===q.params?.name))return respond({jsonrpc:'2.0',id,error:{code:-32601,message:'Tool not found'}});try{const r=await call(q.params.name,q.params.arguments||{});return reply({content:[{type:'text',text:JSON.stringify(r)}],isError:r.status==='FAILED_READBACK'})}catch(e){return reply({content:[{type:'text',text:JSON.stringify({status:'ERROR',reason:String(e.message).slice(0,90)})}],isError:true})}}
return respond({jsonrpc:'2.0',id,error:{code:-32601,message:'Method not found'}})
}};