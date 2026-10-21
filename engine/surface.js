const PATTERNS = ['planks', 'tiles', 'noise'];
const LICENSES = ['CC0-1.0', 'CC-BY-4.0'];
const SPEC_KEYS = ['id', 'name', 'pattern', 'color', 'secondaryColor', 'width', 'length', 'roughness', 'license', 'author'];
const OPTION_KEYS = ['color', 'rotation', 'width', 'length'];
const HEX = /^#[0-9a-f]{6}$/i;
const ID = /^[a-z][A-Za-z0-9_-]{0,63}$/;

export const SURFACE_PATTERNS = Object.freeze([...PATTERNS]);
export const SURFACE_LICENSES = Object.freeze([...LICENSES]);

function record(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value;
}

function exactKeys(value, allowed, label) {
  const unexpected = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unexpected.length) throw new TypeError(`${label} has unsupported field "${unexpected[0]}"`);
}

function text(value, label, max = 120) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new TypeError(`${label} must be a non-empty string of at most ${max} characters`);
  return value.trim();
}

function color(value, label) {
  if (typeof value !== 'string' || !HEX.test(value)) throw new TypeError(`${label} must use #rrggbb`);
  return value.toLowerCase();
}

function dimension(value, label) {
  if (!Number.isFinite(value) || value < 0.02 || value > 10) throw new TypeError(`${label} must be between 0.02 and 10 metres`);
  return value;
}

export function normalizeSurfaceDefinition(value) {
  const source = record(value, 'Surface definition');
  exactKeys(source, SPEC_KEYS, 'Surface definition');
  const name = record(source.name, 'Surface name');
  exactKeys(name, ['en', 'de'], 'Surface name');
  const id = text(source.id, 'Surface id', 64);
  if (!ID.test(id)) throw new TypeError('Surface id must start with a lowercase letter and contain only letters, numbers, _ or -');
  if (!PATTERNS.includes(source.pattern)) throw new TypeError(`Surface pattern must be one of: ${PATTERNS.join(', ')}`);
  if (!LICENSES.includes(source.license)) throw new TypeError(`Surface license must be one of: ${LICENSES.join(', ')}`);
  if (!Number.isFinite(source.roughness) || source.roughness < 0 || source.roughness > 1) throw new TypeError('Surface roughness must be between 0 and 1');
  return {
    id,
    name: { en: text(name.en, 'English surface name'), de: text(name.de, 'German surface name') },
    pattern: source.pattern,
    color: color(source.color, 'Surface color'),
    secondaryColor: color(source.secondaryColor, 'Surface secondaryColor'),
    width: dimension(source.width, 'Surface width'),
    length: dimension(source.length, 'Surface length'),
    roughness: source.roughness,
    license: source.license,
    author: text(source.author, 'Surface author'),
  };
}

export function validateSurfaceDefinition(value) {
  normalizeSurfaceDefinition(value);
  return true;
}

export function normalizeSurfaceOptions(value = {}) {
  if (value == null) return {};
  const source = record(value, 'Surface options');
  exactKeys(source, OPTION_KEYS, 'Surface options');
  const result = {};
  if (source.color !== undefined) result.color = color(source.color, 'Surface option color');
  if (source.width !== undefined) result.width = dimension(source.width, 'Surface option width');
  if (source.length !== undefined) result.length = dimension(source.length, 'Surface option length');
  if (source.rotation !== undefined) {
    if (!Number.isFinite(source.rotation)) throw new TypeError('Surface option rotation must be a finite number');
    result.rotation = ((source.rotation % 360) + 360) % 360;
  }
  return result;
}

export function validateSurfaceOptions(value) {
  normalizeSurfaceOptions(value);
  return true;
}

export function resolveSurfaceDefinition(definition, options = {}) {
  const spec = normalizeSurfaceDefinition(definition);
  const overrides = normalizeSurfaceOptions(options);
  return { ...spec, ...overrides, rotation: overrides.rotation ?? 0 };
}
