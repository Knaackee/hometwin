// HomeTwin uses metres; Xiaomi zone commands use millimetres in its own map frame.
const point = p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite);
const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const between = (a, b, p) => Math.abs(cross(a,b,p)) < 1e-8 && p.every((v,i) => v >= Math.min(a[i],b[i])-1e-8 && v <= Math.max(a[i],b[i])+1e-8);
function intersects(a,b,c,d) {
  return between(a,b,c) || between(a,b,d) || between(c,d,a) || between(c,d,b) || (cross(a,b,c)*cross(a,b,d)<0 && cross(c,d,a)*cross(c,d,b)<0);
}
export function validArea(points, line = false) {
  if (!Array.isArray(points) || points.length < (line ? 2 : 3) || points.length > 200 || !points.every(point)) return false;
  if (points.some((p,i) => i && Math.hypot(p[0]-points[i-1][0],p[1]-points[i-1][1])<.01)) return false;
  if (line) return true;
  let sum=0;
  for (let i=0;i<points.length;i++) {
    const a=points[i],b=points[(i+1)%points.length];sum+=a[0]*b[1]-b[0]*a[1];
    for(let j=i+1;j<points.length;j++) if(j!==i+1 && !(i===0 && j===points.length-1) && intersects(a,b,points[j],points[(j+1)%points.length])) return false;
  }
  return Math.abs(sum)>.02;
}
export function mapTransform(pairs) {
  if (!Array.isArray(pairs) || pairs.length!==3 || !pairs.every(p=>point(p.home)&&point(p.robot))) throw Error('calibration');
  const [p,q,r]=pairs, ux=q.home[0]-p.home[0],uz=q.home[1]-p.home[1],vx=r.home[0]-p.home[0],vz=r.home[1]-p.home[1],det=ux*vz-uz*vx;
  if(Math.abs(det)<.1) throw Error('calibration');
  const ax=q.robot[0]-p.robot[0],ay=q.robot[1]-p.robot[1],bx=r.robot[0]-p.robot[0],by=r.robot[1]-p.robot[1];
  const a=(ax*vz-bx*uz)/det,b=(bx*ux-ax*vx)/det,c=(ay*vz-by*uz)/det,d=(by*ux-ay*vx)/det;
  const sx=Math.hypot(a,c),sz=Math.hypot(b,d);
  if(sx<900||sx>1100||sz<900||sz>1100||Math.abs(sx/sz-1)>.02||Math.abs((a*b+c*d)/(sx*sz))>.02) throw Error('calibration');
  return ([x,z])=>[p.robot[0]+a*(x-p.home[0])+b*(z-p.home[1]),p.robot[1]+c*(x-p.home[0])+d*(z-p.home[1])];
}
export function inside(p,points) {
  let result=false;
  for(let i=0,j=points.length-1;i<points.length;j=i++) {const a=points[i],b=points[j];if(between(a,b,p))return true;if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])result=!result;}
  return result;
}
export function overlaps(a,b,line=false) {
  if(a.some(p=>inside(p,b)) && !line || b.some(p=>inside(p,a))) return true;
  return a.some((p,i)=>b.some((q,j)=> (j<b.length-1||!line) && intersects(p,a[(i+1)%a.length],q,b[(j+1)%b.length])));
}
export function cleaningZone(area,profile,areas) {
  if(!profile.entity_id?.startsWith('vacuum.')||area.scope==='site'||area.scope!==profile.scope||area.kind!=='work'||!validArea(area.points))throw Error('zone');
  if(!profile.map_name?.trim())throw Error('mapName');
  if(areas.some(a=>a.scope===area.scope&&['exclude','line'].includes(a.kind)&&outlines(a).some(p=>overlaps(area.points,p,a.kind==='line'))))throw Error('excluded');
  const pts=area.points.map(mapTransform(profile.pairs));
  if(pts.length!==4)throw Error('rectangle');
  const xs=pts.map(p=>p[0]),ys=pts.map(p=>p[1]),box=[Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)];
  if(box.some(n=>n<0||n>51200)||box[2]-box[0]<100||box[3]-box[1]<100)throw Error('bounds');
  const corners=new Set(pts.map(([x,y])=>`${Math.abs(x-box[0])<5?0:Math.abs(x-box[2])<5?1:'?'},${Math.abs(y-box[1])<5?0:Math.abs(y-box[3])<5?1:'?'}`));
  if(corners.size!==4||[...corners].some(c=>c.includes('?')))throw Error('rectangle');
  return box.map(Math.round);
}

// A work area is a union of outlines minus its exclusions; legacy points remain valid.
export const outlines = area => area.parts || [area.points];
export const rings = area => [...outlines(area), ...(area.exclusions || [])];
export const validWorkArea = area => rings(area).length <= 100 && outlines(area).length > 0 && rings(area).every(p=>validArea(p,area.kind==='line'));
export function cleaningZones(area, profile, areas) {
  if(!area.parts)return [cleaningZone(area,profile,areas)];
  if(!profile.entity_id?.startsWith('vacuum.')||area.scope==='site'||area.scope!==profile.scope||area.kind!=='work'||!validWorkArea(area))throw Error('zone');
  if(!profile.map_name?.trim())throw Error('mapName');
  if(areas.some(a=>a.scope===area.scope&&['exclude','line'].includes(a.kind)&&outlines(area).some(p=>outlines(a).some(q=>overlaps(p,q,a.kind==='line')))))throw Error('excluded');
  const transform=mapTransform(profile.pairs), parts=outlines(area).map(p=>p.map(transform)), holes=(area.exclusions||[]).map(p=>p.map(transform)), all=[...parts,...holes];
  // Exact axis-aligned subdivision, never a bounding box or sampled approximation.
  for(const polygon of all)for(let i=0;i<polygon.length;i++){
    const a=polygon[i],b=polygon[(i+1)%polygon.length];
    if(Math.abs(a[0]-b[0])>1e-6&&Math.abs(a[1]-b[1])>1e-6)throw Error('rectangle');
    if(a.some(v=>v<0||v>51200||Math.abs(v-Math.round(v))>1e-6))throw Error('bounds');
  }
  const xs=[...new Set(all.flatMap(p=>p.map(v=>Math.round(v[0]))))].sort((a,b)=>a-b),ys=[...new Set(all.flatMap(p=>p.map(v=>Math.round(v[1]))))].sort((a,b)=>a-b);
  if(xs.length*ys.length>40000)throw Error('tooManyZones');
  const zones=[];let previous=new Map();
  for(let y=0;y<ys.length-1;y++){
    const runs=[];let start=null;
    for(let x=0;x<xs.length;x++){
      const p=[(xs[x]+xs[x+1])/2,(ys[y]+ys[y+1])/2],active=x<xs.length-1&&parts.some(r=>inside(p,r))&&!holes.some(r=>inside(p,r));
      if(active&&start===null)start=xs[x];
      if(!active&&start!==null){runs.push([start,xs[x]]);start=null;}
    }
    const current=new Map();
    for(const [left,right] of runs){const key=`${left},${right}`;let zone=previous.get(key);if(zone)zone[3]=ys[y+1];else{zone=[left,ys[y],right,ys[y+1]];zones.push(zone);}current.set(key,zone);}
    previous=current;
  }
  if(!zones.length||zones.length>5)throw Error('tooManyZones');
  if(zones.some(z=>z[2]-z[0]<100||z[3]-z[1]<100))throw Error('bounds');
  return zones;
}
