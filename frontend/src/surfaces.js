import * as THREE from 'three';
import { normalizeSurfaceDefinition, resolveSurfaceDefinition } from '../../engine/surface.js';
import { BUNDLED_SURFACES } from './surfaces.gen.js';

const freezeDefinition = (definition) => {
  const normalized = normalizeSurfaceDefinition(definition);
  Object.freeze(normalized.name);
  return Object.freeze(normalized);
};

const STANDARD_ORDER = new Map(['oak', 'walnut', 'ash', 'tile', 'tileDark', 'stone', 'concrete', 'carpet'].map((id, index) => [id, index]));
export const FLOOR_SURFACES = Object.freeze(BUNDLED_SURFACES.map(freezeDefinition).sort((a, b) =>
  (STANDARD_ORDER.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (STANDARD_ORDER.get(b.id) ?? Number.MAX_SAFE_INTEGER) || a.id.localeCompare(b.id, 'en')));
const catalog = new Map(FLOOR_SURFACES.map((surface) => [surface.id, surface]));
const canvasCache = new Map(), materialCache = new Map(), previewCache = new Map();
const UV_METRES = 2.4;
const CACHE_LIMIT = 64;

function cached(cache, key) {
  if (!cache.has(key)) return undefined;
  const value = cache.get(key); cache.delete(key); cache.set(key, value);
  return value;
}

function remember(cache, key, value) {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, value);
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
  return value;
}

export function findFloorSurface(id) {
  return catalog.get(id) || null;
}

function hash(text) {
  let value = 2166136261;
  for (let i = 0; i < text.length; i++) { value ^= text.charCodeAt(i); value = Math.imul(value, 16777619); }
  return value >>> 0;
}

function rng(seed) {
  let state = seed || 1;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function vary(hex, amount) {
  const value = Number.parseInt(hex.slice(1), 16), delta = Math.round(255 * amount);
  const channel = (shift) => Math.max(0, Math.min(255, ((value >> shift) & 255) + delta));
  return `#${[channel(16), channel(8), channel(0)].map((part) => part.toString(16).padStart(2, '0')).join('')}`;
}

function canvasFor(surface) {
  const key = [surface.id, surface.pattern, surface.color, surface.secondaryColor, surface.width, surface.length].join('|');
  const cachedCanvas = cached(canvasCache, key);
  if (cachedCanvas) return cachedCanvas;
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 512;
  const context = canvas.getContext('2d'), random = rng(hash(key)), size = canvas.width;
  if (surface.pattern === 'planks') {
    const rows = 4, rowHeight = size / rows;
    context.fillStyle = surface.secondaryColor; context.fillRect(0, 0, size, size);
    for (let row = 0; row < rows; row++) {
      const offset = row % 2 ? -size / 4 : 0;
      for (let col = -1; col < 3; col++) {
        const x = offset + col * size / 2;
        context.fillStyle = vary(surface.color, (random() - 0.5) * 0.08);
        context.fillRect(x + 2, row * rowHeight + 2, size / 2 - 4, rowHeight - 4);
        context.strokeStyle = 'rgba(55,35,20,.16)'; context.beginPath();
        context.moveTo(x + size * 0.08, row * rowHeight + rowHeight * 0.36);
        context.bezierCurveTo(x + size * 0.2, row * rowHeight + rowHeight * 0.22, x + size * 0.35, row * rowHeight + rowHeight * 0.62, x + size * 0.44, row * rowHeight + rowHeight * 0.45);
        context.stroke();
      }
    }
  } else if (surface.pattern === 'tiles') {
    const count = 4, cell = size / count, gap = Math.max(3, size * 0.008);
    context.fillStyle = surface.secondaryColor; context.fillRect(0, 0, size, size);
    for (let x = 0; x < count; x++) for (let y = 0; y < count; y++) {
      context.fillStyle = vary(surface.color, (random() - 0.5) * 0.045);
      context.fillRect(x * cell + gap, y * cell + gap, cell - gap * 2, cell - gap * 2);
    }
  } else {
    context.fillStyle = surface.color; context.fillRect(0, 0, size, size);
    for (let i = 0; i < 9000; i++) {
      context.fillStyle = random() > 0.5 ? vary(surface.color, random() * 0.07) : vary(surface.secondaryColor, random() * 0.05);
      const radius = 0.5 + random() * 1.8;
      context.fillRect(random() * size, random() * size, radius, radius);
    }
  }
  return remember(canvasCache, key, canvas);
}

function safeResolve(definition, options) {
  try { return resolveSurfaceDefinition(definition, options); }
  catch {
    const fallback = catalog.get(definition?.id) || catalog.get('oak');
    return resolveSurfaceDefinition(fallback);
  }
}

function physicalRepeat(surface) {
  if (surface.pattern === 'planks') return { x: surface.length * 2, y: surface.width * 4 };
  if (surface.pattern === 'tiles') return { x: surface.width * 4, y: surface.length * 4 };
  return { x: surface.width, y: surface.length };
}

export function floorSurfaceMaterial(definition, options = {}) {
  const surface = safeResolve(definition, options);
  const key = JSON.stringify(surface);
  const cachedMaterial = cached(materialCache, key);
  if (cachedMaterial) return cachedMaterial;
  const texture = new THREE.CanvasTexture(canvasFor(surface));
  const extent = physicalRepeat(surface);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.repeat.set(UV_METRES / extent.x, UV_METRES / extent.y);
  texture.center.set(0.5, 0.5);
  texture.rotation = THREE.MathUtils.degToRad(surface.rotation);
  const material = new THREE.MeshStandardMaterial({ map: texture, roughness: surface.roughness, metalness: 0 });
  material.userData.surface = surface;
  return remember(materialCache, key, material);
}

export function surfacePreview(definition, options = {}) {
  const surface = safeResolve(definition, options), key = JSON.stringify(surface);
  const cachedPreview = cached(previewCache, key);
  if (cachedPreview) return cachedPreview;
  return remember(previewCache, key, canvasFor(surface).toDataURL('image/png'));
}
