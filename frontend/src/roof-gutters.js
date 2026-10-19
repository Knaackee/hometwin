import * as THREE from 'three';
// Open semicircular gutters follow each pitched plane's horizontal eave.
export function addGutters(local, planes) {
 const material=new THREE.MeshStandardMaterial({color:'#626b73',metalness:.7,roughness:.4,side:THREE.DoubleSide});
 for(const p of planes){
  if(p.flat)continue;
  const f=p.frame, outward=new THREE.Vector3(f.v.x,0,f.v.z).normalize().negate(), radius=.075;
  const positions=[], indices=[], segments=12;
  for(const end of [-1,1])for(let i=0;i<=segments;i++){
   const angle=Math.PI*i/segments, pos=f.origin.clone().addScaledVector(f.u,end*f.width/2).addScaledVector(outward,.07+Math.cos(angle)*radius);
   pos.y-=.045+Math.sin(angle)*radius;positions.push(pos.x,pos.y,pos.z);
  }
  for(let i=0;i<segments;i++){const j=i+segments+1;indices.push(i,j,i+1,i+1,j,j+1);}
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geo.setIndex(indices);geo.computeVertexNormals();
  const mesh=new THREE.Mesh(geo,material);mesh.castShadow=true;mesh.receiveShadow=true;mesh.userData.gutter=true;local.add(mesh);
 }
}
