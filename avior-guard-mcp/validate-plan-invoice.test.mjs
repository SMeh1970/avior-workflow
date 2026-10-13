import test from 'node:test';
import assert from 'node:assert/strict';
import {validatePlanInvoice} from './validate-plan-invoice.mjs';
const base=[{position:1,name:'Товар A 20×20 мм',unit:'шт',quantity:5,price:3648,total:18240},{position:2,name:'Мешок полипропиленовый тканый',unit:'шт',quantity:4,price:50,total:200}];
const cp=()=>base.map(x=>({...x}));
test('accepts identical plan and invoice',()=>assert.equal(validatePlanInvoice(base,cp()).approved,true));
const cases=[
 ['name',0,'name','Товар A'],['name extra',1,'name','Мешок для строительного мусора полипропиленовый тканый'],
 ['unit',0,'unit','уп'],['quantity',0,'quantity',6],['price',0,'price',3600],
 ['amount',0,'total',18241],['arithmetic',1,'total',210],['number',1,'position',3],
 ['non-number',0,'quantity','5'],['zero quantity',0,'quantity',0],['negative price',0,'price',-1]
];
for(const [label,i,f,value] of cases)test('reject '+label,()=>{
 const v=cp();v[i][f]=value;assert.equal(validatePlanInvoice(base,v).approved,false)
});
test('reject removed row',()=>assert.equal(validatePlanInvoice(base,cp().slice(0,1)).approved,false));
test('reject duplicate position',()=>{const v=cp();v[1]={...v[0]};assert.equal(validatePlanInvoice(base,v).approved,false)});
test('reject no independent source',()=>assert.equal(validatePlanInvoice([],cp()).approved,false));
test('whitespace-only differences tolerated',()=>{const v=cp();v[0].name='Товар  A   20×20 мм';assert.equal(validatePlanInvoice(base,v).approved,true)});
