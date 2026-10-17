// Clips tagged device effects to the exact world-space X/Z polygon of their room.
// The mask lives in the fragment shader, so concave outlines and transformed devices
// remain correct without rebuilding effect geometry.
import * as THREE from 'three';

const MAX_ROOM_POINTS = 64;
const SHADER_KEY = 'hometwin-room-effect-clip-v1';
const clipStates = new WeakMap();
const materialOwners = new WeakMap();

function installRoomClip(material, owner) {
  if (materialOwners.has(material) && materialOwners.get(material) !== owner) {
    material = material.clone();
  }
  if (clipStates.has(material)) return material;

  const state = { count: 0, points: Array.from({ length: MAX_ROOM_POINTS }, () => new THREE.Vector2()) };
  const beforeCompile = material.onBeforeCompile;
  const programKey = material.customProgramCacheKey;
  materialOwners.set(material, owner);
  clipStates.set(material, state);
  material.onBeforeCompile = function onBeforeCompile(shader, renderer) {
    beforeCompile?.call(this, shader, renderer);
    shader.uniforms.uRoomPointCount = { value: state.count };
    shader.uniforms.uRoomPoints = { value: state.points };
    state.shader = shader;
    shader.vertexShader = `varying vec3 vRoomWorldPosition;\n${shader.vertexShader}`.replace(
      '#include <project_vertex>',
      'vRoomWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;\n#include <project_vertex>',
    );
    shader.fragmentShader = `
varying vec3 vRoomWorldPosition;
uniform int uRoomPointCount;
uniform vec2 uRoomPoints[${MAX_ROOM_POINTS}];
bool hometwinRoomContains(vec2 p) {
  bool inside = false;
  for (int i = 0; i < ${MAX_ROOM_POINTS}; i++) {
    if (i >= uRoomPointCount) break;
    int j = i == 0 ? uRoomPointCount - 1 : i - 1;
    vec2 a = uRoomPoints[j], b = uRoomPoints[i], ab = b - a, ap = p - a;
    float crossEdge = ab.x * ap.y - ab.y * ap.x;
    if (abs(crossEdge) < 0.00001 && dot(ap, p - b) <= 0.00001) return true;
    if ((a.y > p.y) != (b.y > p.y)) {
      float edgeX = (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x;
      if (p.x < edgeX) inside = !inside;
    }
  }
  return inside;
}
${shader.fragmentShader}`.replace(
      'void main() {',
      'void main() {\n  if (uRoomPointCount < 3 || !hometwinRoomContains(vRoomWorldPosition.xz)) discard;',
    );
  };
  material.customProgramCacheKey = function customProgramCacheKey() {
    return `${programKey?.call(this) || ''}|${SHADER_KEY}`;
  };
  material.needsUpdate = true;
  return material;
}

function updateState(material, points) {
  const state = clipStates.get(material);
  // Never approximate or leak across walls: an unsupported outline hides the effect.
  state.count = points?.length >= 3 && points.length <= MAX_ROOM_POINTS ? points.length : 0;
  for (let i = 0; i < state.count; i++) {
    state.points[i].x = points[i][0];
    state.points[i].y = points[i][1];
  }
  if (state.shader) state.shader.uniforms.uRoomPointCount.value = state.count;
}

// A missing room hides only the tagged effects; the device mesh remains visible and active.
export function clipRoomEffects(root, points) {
  if (!root) return;
  const owner = root;
  root.traverse((object) => {
    if (!object.userData.roomEffect || !object.material) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    const clipped = materials.map((material) => installRoomClip(material, owner));
    object.material = Array.isArray(object.material) ? clipped : clipped[0];
    clipped.forEach((material) => updateState(material, points));
  });
}

export { MAX_ROOM_POINTS };
