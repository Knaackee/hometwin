import assert from 'node:assert/strict';
import * as THREE from 'three';
import {solarModules,rowModules,fitsModule,solarSelection,translatedSolar,moduleSize,SOLAR_FORMATS} from '../frontend/src/solar-layout.js';
const frame={origin:new THREE.Vector3(),u:new THREE.Vector3(1,0,0),v:new THREE.Vector3(0,0,1),width:12,slope:8};
const plane={frame,pts:[new THREE.Vector3(-6,0,0),new THREE.Vector3(6,0,0),new THREE.Vector3(0,0,8)]};
const legacy=solarModules({rows:2,cols:3,portrait:true,offset:[.2,.4]},plane);assert.equal(legacy.length,6);assert.equal(legacy[0].u,-.96);assert.equal(legacy[0].v,3.48);
const tree=rowModules([6,4,2]);assert.equal(tree.length,12);for(const m of tree)assert(fitsModule(m,plane,tree.filter(x=>x!==m)));
assert(!fitsModule({u:5,v:6},plane));assert(!fitsModule(tree[0],plane,[tree[0]]));assert(!fitsModule(tree[0],plane,[],[{u:tree[0].u,v:tree[0].v,w:1,h:1}]));
assert.deepEqual(solarModules({modules:[]},plane),[]);
console.log('PASS legacy placement, triangular hip layout, edges, overlaps, roof fixtures, empty field');

assert.equal(solarSelection(tree,0,'field').length,12);
assert.equal(solarSelection(tree,7,'row').length,4);
assert.deepEqual(solarSelection(tree,7,'module'),[7]);
const shifted=translatedSolar(tree,solarSelection(tree,0,'field'),.01,0,plane);
assert(shifted);assert.equal(shifted[0].u,+(tree[0].u+.01).toFixed(6));
assert(translatedSolar(tree,solarSelection(tree,0,'field'),100,0,plane),'overhang is advisory');
const changed=tree.map(m=>({...m}));changed[7].v+=.4;assert.equal(solarSelection(changed,7,'row').length,4);
console.log('PASS field/row/module selection and advisory group boundaries');

const outside=[{u:4,v:5,portrait:true,row:0}];
assert(translatedSolar(outside,[0],-.1,0,plane),'partially invalid field can move toward valid position');
assert(translatedSolar(outside,[0],.1,0,plane),'manual placement is not blocked');
console.log('PASS manual movement despite legacy edge violations');

for(const [width,length] of SOLAR_FORMATS){assert.deepEqual(moduleSize(true,{width,length}),[width,length]);assert.deepEqual(moduleSize(false,{width,length}),[length,width]);}
assert.deepEqual(moduleSize(true),[1.13,1.72]);
const sized=rowModules([2],false,{width:1.134,length:1.961});assert.equal(sized[1].u-sized[0].u,1.991);assert.equal(sized[0].length,1.961);
assert(translatedSolar(tree,[0],tree[1].u-tree[0].u,0,plane),'overlaps remain movable');
console.log('PASS dimension presets, orientation, row spacing, overlap and overhang advisory');
