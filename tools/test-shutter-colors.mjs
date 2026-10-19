import assert from 'node:assert/strict';
const ctx=new Proxy({createLinearGradient:()=>({addColorStop(){}}),createRadialGradient:()=>({addColorStop(){}})},{get:(t,k)=>t[k]||(()=>{})});globalThis.document={createElement:()=>({getContext:()=>ctx})};
const {buildLevel}=await import('../frontend/src/house.js');const {shutterColors}=await import('../frontend/src/opening-models.js');
for(const type of ['window','door']) {
 const o={id:'o',type,from:[1,0],to:[2,0],sill:.9,head:2.1,cover:'cover.test',frameColor:'#ffffff',shutterColor:'#336699',shutterFrameColor:'#bb8844'};
 const level={id:'l',height:2.8,cutHeight:1.2,rooms:[{id:'r',kind:'room',points:[[0,0],[4,0],[4,4],[0,4]]}],openings:[o]};const site={facade:{frame:'#543210'}};
 const shutter=buildLevel(level,site).windows.o.shutter;assert.equal(shutter.material.color.getHexString(),'336699');assert(shutter.children.every(c=>c.material.color.getHexString()==='bb8844'));
 delete o.shutterFrameColor;assert.equal(shutterColors(o,site).frame,'#ffffff');delete o.frameColor;assert.equal(shutterColors(o,site).frame,'#543210');delete o.shutterColor;assert.equal(shutterColors(o,site).slats,'#a3abb8');
}
console.log('PASS independent shutter slat/trim colours for doors/windows and legacy/frame fallback');
