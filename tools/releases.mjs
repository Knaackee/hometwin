import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const data = JSON.parse(readFileSync(new URL('frontend/src/releases.json', root), 'utf8'));
const manifest = JSON.parse(readFileSync(new URL('custom_components/hometwin/manifest.json', root), 'utf8'));
const constants = readFileSync(new URL('custom_components/hometwin/const.py', root), 'utf8');
const versions = new Set();
const versionPattern = /^\d+\.\d+\.\d+(?:(?:-|\.?)(?:beta|b)[.-]?\d+)?$/i;
const versionParts = (value) => {
  const match = versionPattern.exec(value);
  return match && [...match[0].match(/\d+/g).slice(0, 3).map(Number), /(?:beta|b)/i.test(value) ? Number(value.match(/\d+$/)[0]) : Infinity];
};
const compareVersions = (left, right) => {
  const a = versionParts(left), b = versionParts(right);
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  return 0;
};

assert.equal(data.schema, 1, 'Unsupported release data schema');
assert(Array.isArray(data.releases) && data.releases.length, 'Release data must contain releases');
for (const [index, release] of data.releases.entries()) {
  assert(versionPattern.test(release.version), `Invalid release version: ${release.version}`);
  assert(!versions.has(release.version), `Duplicate release version: ${release.version}`);
  versions.add(release.version);
  assert(/^\d{4}-\d{2}-\d{2}$/.test(release.date), `${release.version}: invalid date`);
  assert.equal(new Date(`${release.date}T00:00:00Z`).toISOString().slice(0, 10), release.date, `${release.version}: impossible date`);
  assert(Array.isArray(release.changes) && release.changes.length, `${release.version}: release must contain changes`);
  for (const field of [release.title, ...release.changes]) {
    assert.equal(typeof field?.en, 'string', `${release.version}: missing English text`);
    assert.equal(typeof field?.de, 'string', `${release.version}: missing German text`);
    assert(field.en.trim() && field.de.trim(), `${release.version}: empty localized text`);
  }
  if (index) assert.equal(compareVersions(data.releases[index - 1].version, release.version), 1, 'Releases must be newest first');
}

const latest = data.releases[0].version;
assert.equal(manifest.version, latest, 'Latest release must match manifest.json');
assert.match(constants, new RegExp(`^VERSION = ["']${latest.replaceAll('.', '\\.')}["']$`, 'm'), 'Latest release must match const.py');

function markdown(release) {
  return [`## ${release.version} (${release.date})`, '', ...release.changes.map((change) => `- ${change.en}`), ''].join('\n');
}

if (process.argv.includes('--changelog')) {
  const requested = process.argv[process.argv.indexOf('--changelog') + 1];
  const releases = requested ? data.releases.filter((release) => release.version === requested) : [data.releases[0]];
  assert(releases.length, `Unknown release: ${requested}`);
  process.stdout.write(releases.map(markdown).join('\n'));
} else {
  console.log(`PASS: ${data.releases.length} bilingual releases; latest ${latest} matches integration versions`);
}
