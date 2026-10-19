import assert from 'node:assert/strict';
import {cleaningZones,validWorkArea,inside} from '../frontend/src/robot-geometry.js';
const box=(x,y,w,h)=>[[x,y],[x+w,y],[x+w,y+h],[x,y+h]];
const profile={entity_id:'vacuum.test',scope:'floor',map_name:'Floor',pairs:[{home:[0,0],robot:[10000,10000]},{home:[10,0],robot:[20000,10000]},{home:[0,10],robot:[10000,20000]}]};
const area={kind:'work',scope:'floor',parts:[box(0,0,4,4),box(4,0,4,4)],exclusions:[box(2,1,2,2)]};
assert(validWorkArea(area));
const zones=cleaningZones(area,profile,[]);
assert.equal(zones.reduce((s,[x,y,r,b])=>s+(r-x)*(b-y),0),28e6);
assert(zones.length<=5);
for(let x=.05;x<8;x+=.1)for(let y=.05;y<4;y+=.1){const expected=area.parts.some(p=>inside([x,y],p))&&!area.exclusions.some(p=>inside([x,y],p));const actual=zones.filter(([l,t,r,b])=>10000+x*1000>l&&10000+x*1000<r&&10000+y*1000>t&&10000+y*1000<b);assert.equal(actual.length,expected?1:0);}
assert.deepEqual(cleaningZones({...area,exclusions:[]},profile,[]),[[10000,10000,18000,14000]]);
assert.equal(cleaningZones({...area,parts:[box(0,0,1,1),box(3,3,1,1)],exclusions:[]},profile,[]).length,2);
assert.throws(()=>cleaningZones({...area,parts:[[[0,0],[3,1],[0,3]]]},profile,[]),/rectangle/);
assert.throws(()=>cleaningZones({...area,parts:Array.from({length:6},(_,i)=>box(i*2,0,1,1)),exclusions:[]},profile,[]),/tooManyZones/);
assert.throws(()=>cleaningZones({...area,exclusions:[box(0,0,8,4)]},profile,[]),/tooManyZones/);
assert.throws(()=>cleaningZones(area,profile,[{scope:'floor',kind:'line',points:[[1,0],[1,4]]}]),/excluded/);
assert.equal(cleaningZones({...area,points:box(0,0,1,1),parts:undefined,exclusions:undefined},profile,[]).length,1);
console.log('PASS: exact union, overlap, hole, disconnected areas, no expanded zones, legacy data and unsupported shape guards');
