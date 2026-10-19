import { snap } from './geometry.js';
import { newId } from './plan.js';
import * as THREE from 'three';
import { SOLAR_FORMATS, solarModules, solarPlane, rowModules, fitsModule, solarSelection, translatedSolar } from './solar-layout.js';
import { t } from './i18n.js';
export function solarContext(editor, arr) {
 const roof=[...editor.app.stage.levels.values()].find(o=>o.roof?.planes?.length)?.roof;
 if(!roof)return null;
 const plane=solarPlane(arr,roof.planes), index=roof.planes.indexOf(plane);
 const others=editor.app.plan.site.solar.filter(a=>a!==arr && solarPlane(a,roof.planes)===plane).flatMap(a=>solarModules(a,plane));
 const obstacles=(editor.app.plan.site.roofItems||[]).filter(i=>+i.plane===index).map(i=>({u:i.u,v:i.v+i.h/2,w:i.w,h:i.h}));
 return {roof,plane,index,others,obstacles};
}
export function solarEditorHtml(editor,arr,num) {
 const context=solarContext(editor,arr);if(!context || context.plane.flat)return `<p class="hint">${t('editor.solar.pitchedOnly')}</p>`;
 const modules=solarModules(arr,context.plane), idx=Math.min(editor.solarIndex||0,Math.max(0,modules.length-1)), m=modules[idx];editor.solarIndex=idx;
 return `<p class="hint">${t('editor.solar.customHelp')}</p>${solarWarning(editor,arr)?`<p class="hint" role="status">${t('editor.solar.placementWarning')}</p>`:''}<div class="field"><label for="pvPattern">${t('editor.solar.pattern')}</label><input id="pvPattern" type="text" value="${String(arr.rowPattern || '6, 4, 2').replace(/[^0-9,; ]/g,'')}" placeholder="6, 4, 2"></div><button class="btn small" data-act="pvGenerate">${t('editor.solar.generate')}</button>
 <div class="field"><label for="pvMode">${t('editor.solar.moveSelection')}</label><select id="pvMode">${['field','row','module'].map(mode=>`<option value="${mode}" ${(editor.solarMode||'field')===mode?'selected':''}>${({field:t('editor.solar.mode.field'),row:t('editor.solar.mode.row'),module:t('editor.solar.mode.module')})[mode]}</option>`).join('')}</select></div>
 <div class="field"><label for="pvModule">${t('editor.solar.module')}</label><select id="pvModule">${modules.map((_,i)=>`<option value="${i}" ${i===idx?'selected':''}>${i+1}</option>`).join('')}</select></div>
 ${m ? formatControls(editor,arr,m,num)+`<div class="row2">${num('pvMu',t('editor.solar.moduleU'),m.u,.05)}${num('pvMv',t('editor.solar.moduleV'),m.v,.05)}</div>`:''}
 <div class="actions"><button class="btn small" data-act="pvAdd">${t('editor.solar.addModule')}</button>${m?`<button class="btn small" data-act="pvRotate">${t('editor.solar.rotateModule')}</button><button class="btn small" data-act="pvDetach">${t('editor.solar.detachModule')}</button><button class="btn small" data-act="pvRemove">${t('editor.solar.removeModule')}</button>`:''}</div>`;
}
export function moveSolarModule(editor, arr, idx, u, v) {
 const c=solarContext(editor,arr);if(!c || c.plane.flat)return false;
 const source=solarModules(arr,c.plane),m=source[idx];if(!m)return false;
 const modules=translatedSolar(source,[idx],u-m.u,v-m.v,c.plane,c.others,c.obstacles);if(!modules)return false;
 arr.modules=modules;arr.plane=c.index;return true;
}
export function solarInput(editor,id,v) {
 if(!['pvMode','pvModule','pvMu','pvMv','pvPattern','pvPlane','pvFormat','pvWidth','pvLength','pvOrientation'].includes(id))return false;
 const a=editor.app.plan.site.solar.find(a=>a.id===editor.app.sel?.id);if(!a)return true;
 if(['pvFormat','pvWidth','pvLength','pvOrientation'].includes(id)) {
  const c=solarContext(editor,a);if(!c)return true;
  const modules=solarModules(a,c.plane).map(m=>({...m})),ids=solarSelection(modules,editor.solarIndex||0,editor.solarMode||'field');
  if(id==='pvFormat'&&v==='custom')return true;
  const format=id==='pvFormat'&&SOLAR_FORMATS[+v];
  if((id==='pvFormat'&&!format)||(['pvWidth','pvLength'].includes(id)&&(!Number.isFinite(+v)||+v<.1||+v>5)))return true;
  for(const i of ids){const m=modules[i];if(format)[m.width,m.length]=format;if(id==='pvWidth')m.width=+v;if(id==='pvLength')m.length=+v;if(id==='pvOrientation')m.portrait=v==='portrait';}
  a.modules=modules;const m=modules[editor.solarIndex||0];if(m){a.width=m.width;a.length=m.length;a.portrait=m.portrait;}
  editor.app.stage.layout();editor.app.markDirty();editor.renderInspector();return true;
 }
 if(id==='pvPlane') {a.plane=v==='auto'?'auto':+v;editor.app.stage.layout();editor.app.markDirty();editor.renderInspector();return true;}
 if(id==='pvMode'){editor.solarMode=v;editor.renderInspector();return true;}
 if(id==='pvModule'){editor.solarIndex=+v;editor.renderInspector();return true;}
 if(id==='pvPattern')return true;
 const c=solarContext(editor,a), idx=editor.solarIndex||0,m=c&&solarModules(a,c.plane)[idx];
 if(m && moveSolarModule(editor,a,idx,id==='pvMu'?+v:m.u,id==='pvMv'?+v:m.v)){editor.app.stage.layout();editor.app.markDirty();}
 else editor.app.toast(t('editor.solar.noSpace'));
 editor.renderInspector();return true;
}
export function solarAction(editor,act) {
 if(!['pvGenerate','pvAdd','pvRotate','pvRemove','pvDetach'].includes(act))return false;
 const app=editor.app,a=app.plan.site.solar.find(a=>a.id===app.sel?.id),c=a&&solarContext(editor,a);if(!c||c.plane.flat)return true;
 let modules=solarModules(a,c.plane).map(m=>({...m})),idx=editor.solarIndex||0,pattern;
 if(act==='pvGenerate') {
  const raw=app.$('inspBody').querySelector('#pvPattern').value;
  const counts=raw.split(/[,;\s]+/).filter(Boolean).map(Number);
  if(!counts.length || counts.length>12 || counts.some(n=>!Number.isInteger(n)||n<0||n>30)){app.toast(t('editor.solar.badPattern'));return true;}
  pattern=counts.join(', ');modules=rowModules(counts,a.portrait!==false,a);
  idx=0;
 } else if(act==='pvDetach'){if(!modules[idx])return true;modules[idx].row='module-'+Date.now();editor.solarMode='module';}
 else if(act==='pvRemove')modules.splice(idx,1);
 else if(act==='pvRotate') {
  const m=modules[idx];if(!m)return true;m.portrait=m.portrait===false;
 } else {
  let found;
  for(let v=1;v<c.plane.frame.slope&&!found;v+=.1)for(let u=-c.plane.frame.width/2;u<c.plane.frame.width/2;u+=.1){const m={u:+u.toFixed(2),v:+v.toFixed(2),portrait:a.portrait!==false,width:a.width,length:a.length};if(fitsModule(m,c.plane,[...c.others,...modules],c.obstacles)){found=m;break;}}
  if(!found)found={u:0,v:c.plane.frame.slope/2,portrait:a.portrait!==false,width:a.width,length:a.length};found.row='module-'+Date.now();modules.push(found);idx=modules.length-1;editor.solarMode='module';
 }
 app.pushUndo();a.modules=modules;a.plane=c.index;if(pattern)a.rowPattern=pattern;editor.solarIndex=Math.min(idx,Math.max(0,modules.length-1));app.stage.layout();app.markDirty();editor.renderInspector();editor.renderLeft();return true;
}

export function solarMoveCandidate(editor, arr, source, du, dv) {
 const c=editor.drag?.solarContext||solarContext(editor,arr);if(!c||c.plane.flat)return null;
 return translatedSolar(source,solarSelection(source,editor.solarIndex||0,editor.solarMode||'field'),du,dv,c.plane,c.others,c.obstacles);
}
export function startSolarDrag(editor,p,e) {
 const app=editor.app,arr=app.plan.site.solar.find(a=>a.id===p.id),c=arr&&solarContext(editor,arr);
 if(!c||c.plane.flat)return;c.roof.local.updateWorldMatrix(true,false);
 const world=c.roof.local.matrixWorld.clone(),hit=dragSolarPoint(editor,e,{solarContext:c,world});if(!hit)return;
 const now=performance.now(),last=editor._solarClick;
 if(last?.id===p.id&&last.index===p.module&&now-last.time<350)editor.solarMode='module';
 else if(app.sel?.id!==p.id)editor.solarMode='field';
 editor._solarClick={id:p.id,index:p.module,time:now};editor.solarIndex=p.module||0;
 editor.select({type:'solar',id:p.id});
 c.roof.local.updateWorldMatrix(true,false);
 editor.drag={solar:p.id,solarContext:c,world,start:hit,source:solarModules(arr,c.plane).map(m=>({...m})),undo:false};
}
export function nudgeSolar(editor,event,direction,step) {
 const app=editor.app,arr=app.plan.site.solar.find(a=>a.id===app.sel?.id),c=arr&&solarContext(editor,arr);if(!c||c.plane.flat)return false;
 event.preventDefault();event.stopPropagation();
 const source=solarModules(arr,c.plane),next=solarMoveCandidate(editor,arr,source,direction[0]*step,direction[1]*step);
 if(!next){app.toast(t('editor.solar.noSpace'));return true;}
 const signature=arr.id+'|'+(editor.solarMode||'field')+'|'+editor.solarIndex;
 if(!event.repeat||editor._nudge?.plan!==app.plan||editor._nudge?.signature!==signature)app.pushUndo();editor._nudge={plan:app.plan,signature};arr.modules=next;arr.plane=c.index;app.stage.layout();app.markDirty();editor.renderInspector();return true;
}

export function dragSolarPoint(editor,e,d=editor.drag) {
 const c=d.solarContext;if(!c)return null;
 const frame=c.plane.frame,origin=frame.origin.clone().applyMatrix4(d.world),normal=frame.n.clone().transformDirection(d.world);
 const st=editor.app.stage;st.setRay(e);const hit=st.ray.ray.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(normal,origin),new THREE.Vector3());
 if(!hit)return null;hit.applyMatrix4(d.world.clone().invert()).sub(frame.origin);return {plane:c.index,u:hit.dot(frame.u),v:hit.dot(frame.v)};
}
export function previewSolar(editor,arr) {
 const c=editor.drag?.solarContext||solarContext(editor,arr);if(!c)return;
 const f=c.plane.frame;
 for(const mesh of c.roof.panels.filter(m=>m.userData.solar===arr.id)){
  const m=arr.modules[mesh.userData.solarModule];if(!m)continue;
  mesh.position.copy(f.origin).addScaledVector(f.u,m.u).addScaledVector(f.v,m.v).addScaledVector(f.n,.1);mesh.updateMatrixWorld(true);
 }
 editor.app.stage._shadowDirty=true;editor.app.stage.wake();
}

// Crossing a roof edge changes the mounting plane, not merely the world position.
export function transferSolarDrag(editor,e) {
 const app=editor.app,d=editor.drag,hit=app.stage.roofPlanePoint(e);
 if(!hit||hit.plane===d.solarContext.index)return false;
 const arr=app.plan.site.solar.find(a=>a.id===d.solar),roof=d.solarContext.roof,plane=roof.planes[hit.plane];
 if(!arr||!plane||plane.flat)return false;
 const modules=solarModules(arr,d.solarContext.plane),ids=solarSelection(modules,editor.solarIndex||0,editor.solarMode||'field'),anchor=modules[editor.solarIndex||0];
 if(!anchor)return false;
 const moved=ids.map(i=>({...modules[i],u:snap(hit.u+modules[i].u-anchor.u),v:snap(hit.v+modules[i].v-anchor.v)}));
 if(!d.undo){app.pushUndo();d.undo=true;}
 let target=arr;
 if(ids.length!==modules.length){
  target={...arr,id:newId('pv'),entity_id:null,modules:moved,plane:hit.plane};
  delete target.rowPattern;arr.modules=modules.filter((_,i)=>!ids.includes(i));
  const peak=Number(arr.peak_kw)||0;target.peak_kw=peak*ids.length/modules.length;arr.peak_kw=peak-target.peak_kw;
  app.plan.site.solar.push(target);
 }else{target.modules=moved;target.plane=hit.plane;}
 editor.solarIndex=Math.max(0,ids.indexOf(editor.solarIndex||0));
 d.solar=target.id;app.stage.layout();d.solarContext=solarContext(editor,target);d.solarContext.roof.local.updateWorldMatrix(true,true);d.world=d.solarContext.roof.local.matrixWorld.clone();d.start=hit;d.source=moved.map(m=>({...m}));d.invalid=false;
 editor.select({type:'solar',id:target.id});app.stage.canvas.style.cursor='grabbing';return true;
}

export function solarWarning(editor,arr) {
 const c=solarContext(editor,arr);if(!c)return false;const modules=solarModules(arr,c.plane);
 return modules.some((m,i)=>!fitsModule(m,c.plane,[...c.others,...modules.filter((_,j)=>j!==i)],c.obstacles));
}
function formatControls(editor,arr,m,num){
 const w=m.width||1.13,h=m.length||1.72,idx=SOLAR_FORMATS.findIndex(([a,b])=>Math.abs(a-w)<.00001&&Math.abs(b-h)<.00001);
 return `<p class="hint">${t('editor.solar.formatScope')}</p><div class="field"><label for="pvFormat">${t('editor.solar.format')}</label><select id="pvFormat"><option value="custom" ${idx<0?'selected':''}>${t('editor.solar.customFormat')}</option>${SOLAR_FORMATS.map(([w,h],i)=>`<option value="${i}" ${i===idx?'selected':''}>${Math.round(h*1000)} × ${Math.round(w*1000)} mm</option>`).join('')}</select></div><div class="row2">${num('pvWidth',t('editor.solar.width'),w,.001)}${num('pvLength',t('editor.solar.length'),h,.001)}</div><div class="field"><label for="pvOrientation">${t('editor.solar.orientation')}</label><select id="pvOrientation"><option value="portrait" ${m.portrait!==false?'selected':''}>${t('editor.solar.portrait')}</option><option value="landscape" ${m.portrait===false?'selected':''}>${t('editor.solar.landscape')}</option></select></div>`;
}

export function focusSolar(editor) {
 const app=editor.app,arr=app.plan.site.solar.find(a=>a.id===app.sel?.id),c=arr&&solarContext(editor,arr);if(!c||c.plane.flat)return;
 const modules=solarModules(arr,c.plane),f=c.plane.frame;
 const u=modules.length?modules.reduce((sum,m)=>sum+m.u,0)/modules.length:0,v=modules.length?modules.reduce((sum,m)=>sum+m.v,0)/modules.length:f.slope/2;
 c.roof.local.updateWorldMatrix(true,true);const center=c.roof.local.localToWorld(f.origin.clone().addScaledVector(f.u,u).addScaledVector(f.v,v));
 const n=f.n.clone().transformDirection(c.roof.local.matrixWorld),st=app.stage;
 st.tween=null;st.controls.target.copy(center);st.camera.position.copy(center).addScaledVector(n,Math.max(12,f.width*1.3));st.camera.position.y+=3;st.controls.update();st.wake();
}
