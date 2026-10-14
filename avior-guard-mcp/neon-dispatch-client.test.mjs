import test from 'node:test';
import assert from 'node:assert/strict';
import {createNeonDispatchStore} from './neon-dispatch-client.mjs';
test('missing injected database url -> fail closed',async()=>{
 await assert.rejects(createNeonDispatchStore({url:'',importDriver:async()=>{throw Error('driver should not load')}}),{message:'DATABASE_URL_UNAVAILABLE'});
});
test('missing SQL driver -> fail closed',async()=>{
 await assert.rejects(createNeonDispatchStore({url:'postgres://example.invalid/db',importDriver:async()=>({})}),{message:'NEON_DRIVER_UNAVAILABLE'});
});
test('Neon database driver called with parameterized SQL',async()=>{
 const calls=[];
 const fake=async()=>({neon:()=>({query:async(q,params)=>{calls.push({q,params});return [{operation_key:params[0]}]}})});
 const store=await createNeonDispatchStore({url:'postgres://example.invalid/avior_guard',importDriver:fake});
 const k='a'.repeat(64);
 assert.equal(await store.claim({operationKey:k,fingerprint:k,orderId:'6217',recipient:'test@example.org',sourceId:'TEST'}),true);
 assert.match(calls[0].q,/ON CONFLICT/);
 assert.equal(calls[0].params[3],'test@example.org');
});
