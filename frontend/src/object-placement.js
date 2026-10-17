import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);
const UPWARD_NORMAL = 0.98;
const FLAT_TOLERANCE = 0.01;

function visibleMaterial(material) {
  if (Array.isArray(material)) return material.some((item) => item?.visible !== false);
  return material?.visible !== false;
}

function physicalMeshes(root) {
  const meshes = [];
  const visit = (object, isRoot = false) => {
    if ((!isRoot && object.visible === false) || object.userData?.pool || object.userData?.roomEffect) return;
    if (object.isMesh && object.geometry?.attributes?.position && visibleMaterial(object.material)) meshes.push(object);
    for (const child of object.children) visit(child);
  };
  visit(root, true);
  return meshes;
}

function eachVertex(mesh, transform, callback) {
  const position = mesh.geometry.attributes.position;
  const point = new THREE.Vector3();
  if (!mesh.isInstancedMesh) {
    for (let i = 0; i < position.count; i++) callback(point.fromBufferAttribute(position, i).applyMatrix4(transform));
    return;
  }

  const instance = new THREE.Matrix4();
  const instanceTransform = new THREE.Matrix4();
  for (let j = 0; j < mesh.count; j++) {
    mesh.getMatrixAt(j, instance);
    instanceTransform.multiplyMatrices(transform, instance);
    for (let i = 0; i < position.count; i++) callback(point.fromBufferAttribute(position, i).applyMatrix4(instanceTransform));
  }
}

function rootLocalVertices(root, callback) {
  root.updateWorldMatrix(true, true);
  const inverseRoot = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const transform = new THREE.Matrix4();
  for (const mesh of physicalMeshes(root)) {
    transform.multiplyMatrices(inverseRoot, mesh.matrixWorld);
    eachVertex(mesh, transform, callback);
  }
}

// Bounds of visible, physical geometry in the root object's local coordinates.
export function objectBounds(root) {
  const bounds = new THREE.Box3();
  rootLocalVertices(root, (point) => bounds.expandByPoint(point));
  return bounds;
}

function baseSamples(root) {
  const bounds = objectBounds(root);
  if (bounds.isEmpty()) return [];

  const size = bounds.getSize(new THREE.Vector3());
  const nearBase = Math.max(0.01, Math.min(0.12, size.y * 0.08));
  const base = new THREE.Box2();
  rootLocalVertices(root, (point) => {
    if (point.y <= bounds.min.y + nearBase) base.expandByPoint(new THREE.Vector2(point.x, point.z));
  });
  if (base.isEmpty()) base.set(new THREE.Vector2(bounds.min.x, bounds.min.z), new THREE.Vector2(bounds.max.x, bounds.max.z));

  const width = base.max.x - base.min.x;
  const depth = base.max.y - base.min.y;
  const insetX = Math.min(width * 0.04, 0.01);
  const insetZ = Math.min(depth * 0.04, 0.01);
  const minX = base.min.x + insetX;
  const maxX = base.max.x - insetX;
  const minZ = base.min.y + insetZ;
  const maxZ = base.max.y - insetZ;
  const centerX = (base.min.x + base.max.x) / 2;
  const centerZ = (base.min.y + base.max.y) / 2;
  const local = [
    new THREE.Vector3(centerX, bounds.min.y, centerZ),
    new THREE.Vector3(minX, bounds.min.y, minZ),
    new THREE.Vector3(minX, bounds.min.y, maxZ),
    new THREE.Vector3(maxX, bounds.min.y, minZ),
    new THREE.Vector3(maxX, bounds.min.y, maxZ),
  ];
  root.updateWorldMatrix(true, false);
  return local.map((point) => point.applyMatrix4(root.matrixWorld));
}

function relatedToRoot(candidate, root) {
  if (candidate === root) return true;
  for (let object = candidate.parent; object; object = object.parent) if (object === root) return true;
  for (let object = root.parent; object; object = object.parent) if (object === candidate) return true;
  return false;
}

function hitMaterialVisible(hit) {
  const material = hit.object.material;
  if (!Array.isArray(material)) return material?.visible !== false;
  return material[hit.face?.materialIndex || 0]?.visible !== false;
}

function upwardHit(raycaster, meshes) {
  const normalMatrix = new THREE.Matrix3();
  for (const hit of raycaster.intersectObjects(meshes, false)) {
    if (!hit.face || !hitMaterialVisible(hit)) continue;
    normalMatrix.getNormalMatrix(hit.object.matrixWorld);
    const normal = hit.face.normal.clone().applyMatrix3(normalMatrix).normalize();
    if (normal.dot(UP) >= UPWARD_NORMAL) return hit;
  }
  return null;
}

function worldTop(meshes) {
  let top = -Infinity;
  const point = new THREE.Vector3();
  const instance = new THREE.Matrix4();
  const transform = new THREE.Matrix4();
  for (const mesh of meshes) {
    if (!mesh.isInstancedMesh) {
      eachVertex(mesh, mesh.matrixWorld, (vertex) => { top = Math.max(top, vertex.y); });
      continue;
    }
    const position = mesh.geometry.attributes.position;
    for (let j = 0; j < mesh.count; j++) {
      mesh.getMatrixAt(j, instance);
      transform.multiplyMatrices(mesh.matrixWorld, instance);
      for (let i = 0; i < position.count; i++) {
        point.fromBufferAttribute(position, i).applyMatrix4(transform);
        top = Math.max(top, point.y);
      }
    }
  }
  return top;
}

// Finds the highest real, flat support below the object's base footprint.
// The returned value is the object's bottom elevation relative to the level floor.
export function surfaceElevation(root, supports, floorY) {
  const samples = baseSamples(root);
  if (!samples.length) return 0;

  const floor = Number.isFinite(floorY) ? floorY : 0;
  const raycaster = new THREE.Raycaster();
  let highest = floor;
  for (const support of supports || []) {
    if (!support || support.visible === false || relatedToRoot(support, root)) continue;
    support.updateWorldMatrix(true, true);
    const meshes = physicalMeshes(support);
    const top = worldTop(meshes);
    if (!meshes.length || !Number.isFinite(top) || top <= floor + 1e-5) continue;

    const heights = [];
    for (const sample of samples) {
      raycaster.set(new THREE.Vector3(sample.x, top + 0.1, sample.z), DOWN);
      const hit = upwardHit(raycaster, meshes);
      if (!hit) break;
      heights.push(hit.point.y);
    }
    if (heights.length !== samples.length) continue;
    const low = Math.min(...heights);
    const high = Math.max(...heights);
    if (high - low <= FLAT_TOLERANCE) highest = Math.max(highest, low);
  }
  return Math.max(0, highest - floor);
}

// Legacy mounted objects keep their explicit height until automatic placement is enabled.
export function automaticPlacement(item, type) {
  const floorObject = type === 'furniture' || ['vacuum', 'washer', 'mower'].includes(item.kind) || (item.kind === 'light' && ['floor', 'arc', 'bollard'].includes(item.style));
  return item.autoElevation ?? (floorObject && !Number.isFinite(item.elevation) && !Number.isFinite(item.lift) && !Number.isFinite(item.y));
}
