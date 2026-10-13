import test from 'node:test';
import assert from 'node:assert/strict';
import {validatePositions} from './validate-positions.mjs';
const correct=[
  {position:1,name:'Товар А, 80 мм',unit:'шт',quantity:5,price:3648,total:18240},
  {position:2,name:'Товар Б 10 л',unit:'л',quantity:3,price:78.6,total:235.8}
];
const clone=()=>correct.map(x=>({...x}));
test('accepts complete, exact proposal',()=>{
 const x=validatePositions(correct,clone());
 assert.equal(x.approved,true);
 assert.equal(x.checked_positions,2);
 assert.equal(x.total,18475.8);
});
const changes=[
 ['wrong price',1,'price',300],
 ['wrong quantity',0,'quantity',50],
 ['wrong name',0,'name','Товар А заменён'],
 ['wrong unit',0,'unit','уп'],
 ['wrong total',1,'total',230],
 ['wrong position',1,'position',3],
 ['non-numeric quantity',0,'quantity','5']
];
for(const [name,index,field,value] of changes){
 test('blocks '+name,()=>{
  const changed=clone();changed[index][field]=value;
  assert.equal(validatePositions(correct,changed).approved,false);
 });
}
test('blocks missing item',()=>assert.equal(validatePositions(correct,correct.slice(0,1)).approved,false));
test('blocks duplicate item',()=>assert.equal(validatePositions(correct,[correct[0],correct[0]]).approved,false));
test('rejects no trusted reference',()=>assert.equal(validatePositions([],[]).approved,false));
