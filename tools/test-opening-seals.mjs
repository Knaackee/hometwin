import assert from 'node:assert/strict';
import * as THREE from 'three';
const context = new Proxy({createLinearGradient:()=>({addColorStop(){}}),createRadialGradient:()=>({addColorStop(){}})}, {get:(t,k)=>t[k]||(()=>{})});
globalThis.document={createElement:()=>({getContext:()=>context})};
const {buildLevel}=await import('../frontend/src/house.js');
for(const type of ['window','door']) {
 const sill=type==='window'?.9:0;
 const level={id:'test',height:2.8,cutHeight:1.2,rooms:[{id:'r',kind:'room',points:[[0,0],[4,0],[4,4],[0,4]]}],openings:[{id:'o',type,from:[1,0],to:[3,0],sill,head:2.2,cover:'cover.test'}]};
 const house=buildLevel(level,{}), shutter=house.windows.o.shutter;
 // Test the shutter plus seals alone: no glass or room walls can hide a gap.
 shutter.updateWorldMatrix(true,true);
 const rays=new THREE.Raycaster();
 for(const x of [1.001,1.025,1.08,2,2.92,2.975,2.999]) for(const y of [sill+.001,sill+.03,(sill+2.2)/2,2.17,2.199]) for(const angle of [-.8,0,.8]) {
  const target=new THREE.Vector3(x,y,shutter.position.z);
  const direction=new THREE.Vector3(angle,0,-1).normalize();
  rays.set(target.clone().addScaledVector(direction,-.5),direction);
  assert(rays.intersectObject(shutter,true).length,`${type}: gap at ${x},${y},${angle}`);
 }
 shutter.scale.y=.001;shutter.updateWorldMatrix(true,true);
 rays.set(new THREE.Vector3(2,(sill+2.2)/2,.5),new THREE.Vector3(0,0,-1));
 assert.equal(rays.intersectObject(shutter,true).length,0,'opened shutter leaves clear view');
}
console.log('PASS window/door closed seals block edge and oblique rays; opening clears the view');
