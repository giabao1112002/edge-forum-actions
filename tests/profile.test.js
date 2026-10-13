const test = require('node:test');
const assert = require('node:assert/strict');
const { parseSupportProfile, resolveSupportProfile } = require('../src/features/profile/profile');

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

test('profile links without userid resolve through Microsoft Learn while existing inputs stay offline', async () => {
  const link = 'https://learn.microsoft.com/en-us/users/brianphamwicloudcorporation-2796/';
  let calls = 0;
  const request = async (url, options) => {
    calls++;
    assert.equal(url, 'https://learn.microsoft.com/api/profiles/brianphamwicloudcorporation-2796');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.redirect, 'error');
    return { ok: true, json: async () => ({ userId: profileId.toUpperCase() }) };
  };
  assert.equal(await resolveSupportProfile(link, request), profileId);
  assert.equal(calls, 1);
  assert.equal(await resolveSupportProfile(profileId, request), profileId);
  assert.equal(await resolveSupportProfile(`${link}?userid=${profileId}`, request), profileId);
  assert.equal(calls, 1);
});

test('failed or invalid profile lookups are rejected', async () => {
  const link = 'https://learn.microsoft.com/users/unknown/';
  await assert.rejects(resolveSupportProfile(link, async () => ({ ok: false, status: 404 })), /HTTP 404/);
  await assert.rejects(resolveSupportProfile(link, async () => ({ ok: true,
    json: async () => ({ userId: 'not-a-user-id' }) })), /valid user ID/);
  await assert.rejects(resolveSupportProfile(link, async () => { throw new Error('offline'); }), /while online/);
  await assert.rejects(resolveSupportProfile('https://example.com/users/name/', async () => {
    throw new Error('should not request');
  }), /Microsoft Learn/);
  await assert.rejects(resolveSupportProfile(`${link}?userid=invalid`, async () => {
    throw new Error('should not request');
  }), /invalid user ID/);
});
