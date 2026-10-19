import assert from 'node:assert/strict';
import {buildRecipe,boundsOf} from '../engine/recipe.js';
import {readFileSync} from 'node:fs';
for(const id of ['doors/flush-door','doors/glass-door','windows/fixed-window']) {
 const recipe=JSON.parse(readFileSync(`library/generic/architecture/${id}/recipe.json`,'utf8'));
 for(const [w,h,d] of [[.6,.8,.12],[1,2.1,.22],[2.4,2.6,.35]]) {
  const result=buildRecipe(recipe,{w,h,d});const bounds=boundsOf(result.object);
  for(const [actual,expected] of bounds.size.map((n,i)=>[n,[w,h,d][i]])) assert(Math.abs(actual-expected)<.001,`${id} should fit the opening without scaling`);
  const unmerged=buildRecipe(recipe,{w,h,d},{merge:false}).object;
  const jamb=unmerged.getObjectByName('left jamb');assert.equal(jamb.geometry.parameters.width,.04,'jamb thickness remains constant');
 }
}
console.log('PASS parametric opening bounds and constant frame width across sizes');
