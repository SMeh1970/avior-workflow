import test from 'node:test';
import assert from 'node:assert/strict';
import {loadVerifiedOrder6217,makeGoogleSheetsReader,TRUSTED_6217} from './live-order-6217.mjs';
const registry={values:[['Заявка','Дата заявки','Клиент','Рабочая таблица'],['6217','10.10.2026','ООО «МАРАЩСТРОЙ»','Заявка 6217']]};
const titles=['Вафельное полотно: ширина - 80 см, рулон - 50 метров','Диск алмазный отрезной Hilberg турбо ультратонкий 125x22.23 Hard Materials X-type','Алюминиевое правило 1 ребро жесткости, L-3,0 м.','Алюмининевое правило прямоугольное 70*30 L-3.0','Плиткорез 300 мм','Плиткорез 600 мм','Сверло по керамограниту 4 грани 6мм','Наборы ключей имбусовых TORX','Набор отверток SL+PH WDK-SD1006','Монтировка с пластиковой накладкой (500мм)'];
const sheet={values:[['Заявка №6217','10.10.2026','Клиент: ООО «МАРАЩСТРОЙ»'],['Объект','Москва, ЖК «Остров 7.2»','Срок по заявке','14.10.2026','Желаемая отсрочка','30 дней'],['Состояние','КП получены'],[],['ID','Наименование по заявке','Количество','Ед.','Группа','Статус позиции'],...titles.map((v,i)=>[String(21212+i),v,[10,50,20,20,2,1,100,2,2,5][i],i===0?'Рулон':'шт','ТМЦ','Не согласовано'])]};
const copy=x=>structuredClone(x);
const readers=(r=registry,s=sheet)=>async (id,range)=>{
 assert.ok((id===TRUSTED_6217.registryId&&range===TRUSTED_6217.registryRange)||(id===TRUSTED_6217.orderId&&range===TRUSTED_6217.orderRange));
 return id===TRUSTED_6217.registryId?r:s;
};
test('reads exact full ten real-order names, quantities and independent registry link',async()=>{
 const result=await loadVerifiedOrder6217(readers());assert.equal(result.positions.length,10);
 assert.deepEqual(result.positions.map(p=>p.name),titles);assert.ok(result.sourceId.startsWith('SHEETS_REGISTRY_AND_ORDER_6217_SHA256_'));
});
test('rejects registry omitting order',async()=>{const r=copy(registry);r.values.pop();await assert.rejects(loadVerifiedOrder6217(readers(r)),{code:'REGISTRY_LINK_INVALID'});});
test('rejects unexpected registry link',async()=>{const r=copy(registry);r.values[1][3]='Unknown';await assert.rejects(loadVerifiedOrder6217(readers(r)),{code:'REGISTRY_LINK_INVALID'});});
test('rejects duplicate registry entry',async()=>{const r=copy(registry);r.values.push(copy(r.values[1]));await assert.rejects(loadVerifiedOrder6217(readers(r)),{code:'REGISTRY_LINK_INVALID'});});
test('rejects removed position',async()=>{const s=copy(sheet);s.values.pop();await assert.rejects(loadVerifiedOrder6217(readers(registry,s)),{code:'ORDER_ITEM_COUNT_CHANGED'});});
test('rejects unexpected 11th position',async()=>{const s=copy(sheet);s.values.push(['21222','Extra',1,'шт']);await assert.rejects(loadVerifiedOrder6217(readers(registry,s)),{code:'ORDER_ITEM_COUNT_CHANGED'});});
test('rejects changed units and quantity',async()=>{const s=copy(sheet);s.values[5][2]=null;await assert.rejects(loadVerifiedOrder6217(readers(registry,s)),{code:'ORDER_ITEM_INVALID'});});
test('rejects duplicate item IDs',async()=>{const s=copy(sheet);s.values[6][0]='21212';await assert.rejects(loadVerifiedOrder6217(readers(registry,s)),{code:'ORDER_ITEM_INVALID'});});
test('fingerprint changes after source changes',async()=>{const s=copy(sheet);s.values[6][2]=999;const before=await loadVerifiedOrder6217(readers());const after=await loadVerifiedOrder6217(readers(registry,s));assert.notEqual(before.sourceFingerprint,after.sourceFingerprint);});
test('reader denies caller-supplied sheet ID before API',async()=>{const reader=makeGoogleSheetsReader({getToken:async()=>{throw Error('NO_API')},fetcher:()=>{throw Error('NO_API')}});await assert.rejects(reader('malicious','A1:B2'),{code:'UNTRUSTED_SOURCE_REQUEST'});});
test('fixed reader uses only GET, hides bearer and checks status',async()=>{
 let observed;const reader=makeGoogleSheetsReader({getToken:async()=> 'real-unexposed-token',fetcher:async (url,opts)=>{observed={url,method:opts.method};return {ok:true,json:async()=>sheet}}});
 const response=await reader(TRUSTED_6217.orderId,TRUSTED_6217.orderRange);assert.deepEqual(response,sheet);assert.equal(observed.method,'GET');assert.ok(!observed.url.includes('real-unexposed-token'));
});