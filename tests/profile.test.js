const test = require('node:test');
const assert = require('node:assert/strict');
const { parseSupportProfile } = require('../src/features/profile/profile');

const profileId = '696f09c3-51ea-4371-99ea-14d4c83bead8';
test('teammates can set their own profile by ID or Microsoft Learn link', () => {
  assert.equal(parseSupportProfile(` ${profileId.toUpperCase()} `), profileId);
  assert.equal(parseSupportProfile(`https://learn.microsoft.com/en-us/users/na/?userid=${profileId}`), profileId);
  assert.equal(parseSupportProfile(`https://learn.microsoft.com/users/na/?userid=${profileId}&foo=bar`), profileId);
});
test('rejects thread URLs and non-Microsoft links as support profiles', () => {
  assert.throws(() => parseSupportProfile('hello'), /profile link/);
  assert.throws(() => parseSupportProfile(`https://example.com/users/na/?userid=${profileId}`), /Microsoft Learn/);
  assert.throws(() => parseSupportProfile(`https://learn.microsoft.com/en-us/answers/questions/1?userid=${profileId}`), /Microsoft Learn/);
});
