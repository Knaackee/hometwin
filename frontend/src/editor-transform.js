import { snap } from './geometry.js';
import * as THREE from 'three';
import { findItem } from './plan.js';
import { solarContext, solarMoveCandidate, previewSolar } from './editor-solar.js';
import { solarModules, solarSelection } from './solar-layout.js';

// A small shared transform overlay. Screen-space projection keeps dragging stable
// even when a roof plane or the vertical axis is nearly edge-on.
export function updateTransform(stage) {
 const app=stage.app,editor=app.editor,sel=app.sel;
 if(!stage.transform){const group=new THREE.Group();group.renderOrder=1000;stage.overlay.add(group);stage.transform=group;
  for(const [axis,color] of [['x',0xff7766],['z',0x6699ff],['y',0x66dd99]]){const arrow=new THREE.ArrowHelper(new THREE.Vector3(1,0,0),new THREE.Vector3(),1,color,.22,.14);arrow.userData.axis=axis;arrow.traverse(o=>{if(o.material){o.material.depthTest=false;o.material.depthWrite=false;}o.renderOrder=1000;});group.add(arrow);}
 }
 const group=stage.transform;group.visible=false;if(app.mode!=='edit'||editor?.tool!=='select'||!sel)return;
 let center,axes={x:new THREE.Vector3(1,0,0),z:new THREE.Vector3(0,0,1),y:new THREE.Vector3(0,1,0)};
 if(sel.type==='solar'){
  const arr=app.plan.site.solar.find(a=>a.id===sel.id),c=arr&&solarContext(editor,arr);if(!c||c.plane.flat)return;
  c.roof.local.updateWorldMatrix(true,true);
  const ids=solarSelection(solarModules(arr,c.plane),editor.solarIndex||0,editor.solarMode||'field');
  const meshes=c.roof.panels.filter(m=>m.userData.solar===arr.id&&ids.includes(m.userData.solarModule));if(!meshes.length)return;
  const box=new THREE.Box3();for(const m of meshes)box.expandByObject(m);center=box.getCenter(new THREE.Vector3());
  axes.x=c.plane.frame.u.clone().transformDirection(c.roof.local.matrixWorld);axes.z=c.plane.frame.v.clone().transformDirection(c.roof.local.matrixWorld);
 }else if(sel.type==='roofitem'){
  const item=(app.plan.site.roofItems||[]).find(i=>i.id===sel.id),c=item&&solarContext(editor,item);if(!c||c.plane.flat)return;
  c.roof.local.updateWorldMatrix(true,true);const f=c.plane.frame;
  center=c.roof.local.localToWorld(f.origin.clone().addScaledVector(f.u,item.u||0).addScaledVector(f.v,(item.v||0)+(item.h||1)/2).addScaledVector(f.n,.2));
  axes.x=f.u.clone().transformDirection(c.roof.local.matrixWorld);axes.z=f.v.clone().transformDirection(c.roof.local.matrixWorld);
 }else if(['furniture','device'].includes(sel.type)){
  const f=findItem(app.plan,sel.id);if(!f?.item?.pos||f.item.locked)return;
  center=new THREE.Vector3(f.item.pos[0],stage.displayY(f.level)+stage.itemElevation(f.level.id,sel.type,f.item.id)+.15,f.item.pos[1]);
 }else return;
 group.visible=true;group.position.copy(center);group.userData.axes=axes;
 for(const arrow of group.children){arrow.visible=arrow.userData.axis!=='y'||sel.type==='furniture';arrow.setDirection(axes[arrow.userData.axis]);arrow.setColor(editor.drag?.invalid?0xff3344:({x:0xff7766,z:0x6699ff,y:0x66dd99})[arrow.userData.axis]);}
 group.updateWorldMatrix(true,true);
}
export function startTransform(editor,e){
 const app=editor.app,st=app.stage;updateTransform(st);const group=st.transform;if(!group.visible)return false;
 st.setRay(e);st.ray.params.Line.threshold=.12;const hit=st.ray.intersectObjects(group.children.filter(a=>a.visible).flatMap(a=>[a.cone,a.line]),false).find(h=>h.object.type!=='Line'||h.point.distanceTo(group.position)>.25);if(!hit)return false;
 const axis=hit.object.parent.userData.axis,origin=group.position.clone(),end=origin.clone().add(group.userData.axes[axis]);
 const r=st.canvas.getBoundingClientRect(),px=p=>{p.project(st.camera);return [(p.x+1)*r.width/2,(1-p.y)*r.height/2];},a=px(origin),b=px(end),screen=[b[0]-a[0],b[1]-a[1]];
 if(Math.hypot(...screen)<5)return false;
 if(app.sel.type==='roofitem'){const item=app.plan.site.roofItems.find(i=>i.id===app.sel.id);editor.drag={transform:true,axis,screen,x:e.clientX,y:e.clientY,roofItemObject:item,origin:[item.u||0,item.v||0],undo:false};return true;}
 const sel=app.sel,arr=sel.type==='solar'&&app.plan.site.solar.find(a=>a.id===sel.id),c=arr&&solarContext(editor,arr),found=!arr&&findItem(app.plan,sel.id);
 editor.drag={solarContext:c,transform:true,axis,screen,x:e.clientX,y:e.clientY,arr,source:arr?solarModules(arr,c.plane).map(m=>({...m})):null,found,origin:found&&[...found.item.pos],height:found&&st.itemElevation(found.level.id,sel.type,found.item.id),type:sel.type,undo:false};return true;
}
export function moveTransform(editor,e){
 const d=editor.drag;if(!d?.transform)return false;const app=editor.app,st=app.stage;
 const [sx,sy]=d.screen,step=(e.ctrlKey||e.metaKey)?0.01:e.shiftKey?0.5:0.05;
 const delta=snap(((e.clientX-d.x)*sx+(e.clientY-d.y)*sy)/(sx*sx+sy*sy),step);
 if(!delta&&!d.undo)return true;
 const next=d.arr&&solarMoveCandidate(editor,d.arr,d.source,d.axis==='x'?delta:0,d.axis==='z'?delta:0);
 d.invalid=!!d.arr&&!next;st.canvas.style.cursor=d.invalid?'not-allowed':'grabbing';
 if(d.invalid)return true;if(!d.undo){app.pushUndo();d.undo=true;}
 if(d.roofItemObject){const item=d.roofItemObject;item.u=d.origin[0]+(d.axis==='x'?delta:0);item.v=d.origin[1]+(d.axis==='z'?delta:0);const roof=[...st.levels.values()].find(o=>o.roof?.rebuildItem)?.roof;roof?.rebuildItem(item);}
 else if(d.arr){d.arr.modules=next;previewSolar(editor,d.arr);}else{const {item,level}=d.found;if(d.axis==='y'){item.elevation=Math.max(0,d.height+delta);item.autoElevation=false;}else{item.pos=[...d.origin];item.pos[d.axis==='x'?0:1]+=delta;}st.moveItem(level.id,d.type,item);st.select(app.sel);}
 return true;
}
