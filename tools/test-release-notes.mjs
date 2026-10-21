import assert from 'node:assert/strict';
import { compareReleaseVersions, CURRENT_RELEASE, RELEASES, shouldShowReleaseNotes } from '../frontend/src/release-notes.js';

assert.equal(CURRENT_RELEASE, RELEASES[0]);
assert.equal(compareReleaseVersions('0.6.0', '0.5.1'), 1);
assert.equal(compareReleaseVersions('0.6.0', '0.6.0'), 0);
assert.equal(compareReleaseVersions('0.6.0b1', '0.6.0'), -1);
assert.equal(compareReleaseVersions('0.6.0-beta.2', '0.6.0-beta.1'), 1);
assert.equal(compareReleaseVersions('invalid', 'invalid'), 0);
assert.equal(compareReleaseVersions('0.6.0', 'invalid'), null);
assert.equal(shouldShowReleaseNotes('0.6.0', ''), true, 'first install of the feature shows current notes');
assert.equal(shouldShowReleaseNotes('0.6.0', '0.5.1'), true, 'upgrade shows current notes');
assert.equal(shouldShowReleaseNotes('0.6.0', '0.6.0'), false, 'same-version local changes do not show again');
assert.equal(shouldShowReleaseNotes('0.5.1', '0.6.0'), false, 'downgrades do not show old notes');
assert.equal(shouldShowReleaseNotes('0.6.0', 'corrupt'), false, 'unknown stored values do not create a popup loop');
assert(!JSON.stringify(CURRENT_RELEASE).match(/robot|vacuum/i), 'current release does not advertise unpublished robot work');
assert.equal(CURRENT_RELEASE.version, '0.7.0');
assert.equal(shouldShowReleaseNotes('0.7.0', '0.6.0'), true);

console.log('PASS: release ordering, first-use, upgrade and same-version behavior');
