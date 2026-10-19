import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const browser=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:4185/demo/');await page.waitForFunction(()=>document.querySelector('hometwin-panel')?.plan);
 const result=await page.evaluate(()=>{
  const a=document.querySelector('hometwin-panel'),st=a.stage;a.$('onboard').hidden=true;st.stop();a.setMode('edit');a.setLevel('roof');st.rise=null;st.tween=null;
  a.plan.site.roof={...a.plan.site.roof,type:'hip',rect:{cx:5,cz:4,length:18,width:14,rot:0},pitch:40};a.plan.site.roofItems=[];a.plan.site.solar=[{id:'cross',plane:2,modules:[{u:0,v:2,portrait:true,row:0},{u:1.3,v:2,portrait:true,row:0}],peak_kw:1}];st.layout();a.editor.solarMode='module';a.editor.solarIndex=0;a.editor.select({type:'solar',id:'cross'});
  const aim=(index,u,v)=>{const roof=[...st.levels.values()].find(o=>o.roof?.planes?.length).roof;roof.local.updateWorldMatrix(true,true);const f=roof.planes[index].frame,p=roof.local.localToWorld(f.origin.clone().addScaledVector(f.u,u).addScaledVector(f.v,v)),n=f.n.clone().transformDirection(roof.local.matrixWorld);st.controls.target.copy(p);st.camera.position.copy(p).addScaledVector(n,20);st.controls.update();st.tick();const q=p.clone().project(st.camera),r=st.canvas.getBoundingClientRect();return {clientX:r.left+(q.x+1)*r.width/2,clientY:r.top+(1-q.y)*r.height/2,button:0};};
  a.editor.pointerDown(aim(2,0,2));if(!a.editor.drag?.solar)throw Error('source selection failed');
  a.editor.pointerMove(aim(0,0,2));a.editor.pointerUp({},true);st.tick();
  return {arrays:structuredClone(a.plan.site.solar),selected:a.sel,errors:[]};
 });
 assert.equal(result.arrays.length,2);assert.equal(result.arrays[0].plane,2);assert.equal(result.arrays[0].modules.length,1);assert.equal(result.arrays[1].plane,0);assert.equal(result.arrays[1].modules.length,1);assert.equal(result.selected.id,result.arrays[1].id);
 await page.screenshot({path:'.preview/solar-cross-plane.png'});assert.deepEqual(errors,[]);console.log('PASS module changes roof face, source retained, destination selected and rendered');
}finally{await browser.close();}
