// PV positions in metres along a roof plane: u across, v from eave to ridge.
export const SOLAR_FORMATS = [[.992,1.650],[1.134,1.722],[1.134,1.762],[1.134,1.961],[1.134,2.278]];
export function moduleSize(portrait=true, dimensions={}) {
 const w=Number.isFinite(dimensions.width)&&dimensions.width>0?dimensions.width:1.13;
 const h=Number.isFinite(dimensions.length)&&dimensions.length>0?dimensions.length:1.72;
 return portrait?[w,h]:[h,w];
}
export function solarModules(arr, plane) {
  if (Array.isArray(arr.modules)) return arr.modules;
  const [w, h] = moduleSize(arr.portrait !== false,arr), rows = Math.max(1, arr.rows || 1), cols = Math.max(1, arr.cols || 1);
  const height = rows * h + (rows - 1) * .12;
  const center = plane.flat ? 0 : Math.max(height / 2 + .3, plane.frame.slope / 2);
  return Array.from({length: rows * cols}, (_, i) => ({u: (i % cols - (cols - 1) / 2) * (w + .03) + (arr.offset?.[0] || 0), v: (Math.floor(i / cols) - (rows - 1) / 2) * (h + .12) + center + (arr.offset?.[1] || 0), portrait: arr.portrait !== false, width:arr.width,length:arr.length,row: Math.floor(i / cols)}));
}
export function solarPlane(arr, planes) {
  if (arr.plane !== 'auto' && arr.plane != null) return planes[Math.max(0, Math.min(planes.length - 1, +arr.plane || 0))];
  return planes.reduce((best, p) => !best || p.flat || Math.abs(((p.azimuth ?? 180) - 180 + 540) % 360 - 180) < Math.abs(((best.azimuth ?? 180) - 180 + 540) % 360 - 180) ? p : best, null);
}
function rectangle(m) { const [w,h] = moduleSize(m.portrait !== false,m);return {u:m.u,v:m.v,w,h}; }
function overlaps(a,b) { return Math.abs(a.u-b.u)<(a.w+b.w)/2+.029 && Math.abs(a.v-b.v)<(a.h+b.h)/2+.029; }
export function edgeViolation(m, plane) {
 if (![m.u,m.v].every(Number.isFinite))return Infinity;
 const a=rectangle(m),f=plane.frame;
 const polygon=plane.pts?.map(p=>{const d=p.clone().sub(f.origin);return [d.dot(f.u),d.dot(f.v)];})||[[-f.width/2,-f.slope/2],[f.width/2,-f.slope/2],[f.width/2,f.slope/2],[-f.width/2,f.slope/2]];
 const sign=Math.sign(polygon.reduce((s,p,i)=>{const q=polygon[(i+1)%polygon.length];return s+p[0]*q[1]-q[0]*p[1];},0));let violation=0;
 for(const x of [-1,1])for(const y of [-1,1])for(let i=0;i<polygon.length;i++){
  const p=polygon[i],q=polygon[(i+1)%polygon.length],dx=q[0]-p[0],dy=q[1]-p[1];
  violation+=Math.max(0,.1-sign*(dx*(a.v+y*a.h/2-p[1])-dy*(a.u+x*a.w/2-p[0]))/Math.hypot(dx,dy));
 }
 return violation;
}
export function fitsModule(m,plane,others=[],obstacles=[]) {
 return edgeViolation(m,plane)<1e-7&&!others.some(b=>overlaps(rectangle(m),rectangle(b)))&&!obstacles.some(b=>overlaps(rectangle(m),b));
}
export function rowModules(counts, portrait=true, dimensions={}) {
  const [w,h]=moduleSize(portrait,dimensions);
  return counts.flatMap((count,r)=>Array.from({length:count},(_,c)=>({u:(c-(count-1)/2)*(w+.03),v:.3+h/2+r*(h+.12),portrait,width:dimensions.width,length:dimensions.length,row:r})));
}

// Stable row IDs survive moving a single module; old plans fall back to their v coordinate.
export function solarSelection(modules, index, mode = 'field') {
 const selected=modules[index];
 return modules.map((m,i)=>i).filter(i=>mode==='field'||(mode==='module'?i===index:selected && (selected.row!=null ? modules[i].row===selected.row : Math.abs(modules[i].v-selected.v)<.01)));
}
export function translatedSolar(modules, indices, du, dv, plane, others=[], obstacles=[]) {
 const selected=new Set(indices);
 const next=modules.map((m,i)=>selected.has(i)?{...m,u:+(m.u+du).toFixed(6),v:+(m.v+dv).toFixed(6)}:{...m});
 return next.every(m=>Number.isFinite(m.u)&&Number.isFinite(m.v))?next:null;
}
