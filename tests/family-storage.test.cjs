const test = require('node:test');
const assert = require('node:assert/strict');
const Storage = require('../assets/family-storage.js');
const Model = require('../assets/family-model.js');
function environment({ cookies = true, storage = true } = {}) {
  const jar = new Map(), values = new Map();
  return { location: { port: '4173', protocol: 'http:' }, document: {
    get cookie() { return [...jar].map(([k, v]) => k + '=' + v).join('; '); },
    set cookie(text) { if (cookies) { const pair = text.split(';')[0], index = pair.indexOf('='); jar.set(pair.slice(0, index), pair.slice(index + 1)); } }
  }, localStorage: {
    getItem: key => values.get(key) || null,
    setItem: (key, value) => { if (!storage) throw new Error('quota'); values.set(key, value); },
    removeItem: key => values.delete(key)
  } };
}
const payload = { version: 'v1', data: { schemaVersion: 2, familyName: '契爺孫家族', people: [] } };
test('Cookie JSON restores after recreating storage and retains Unicode', () => {
  const env = environment();
  assert.equal(Storage.create(env, Model.build).save(payload), 'cookie');
  assert.deepEqual(Storage.create(env, Model.build).read().data, payload.data);
  assert.match(env.document.cookie, /%/);
});
test('large JSON uses full localStorage and only a small cookie marker', () => {
  const env = environment(), cache = Storage.create(env, Model.build);
  cache.save(payload);
  const large = { ...payload, data: { ...payload.data, notes: '族譜'.repeat(20000) } };
  assert.equal(cache.save(large), 'localStorage');
  assert(env.document.cookie.length < 100);
  assert.deepEqual(Storage.create(env, Model.build).read().data, large.data);
});
test('blocked cookies fall back; quota failure is reported; invalid backups are ignored', () => {
  const env = environment({ cookies: false });
  const cache = Storage.create(env, Model.build);
  assert.equal(cache.save(payload), 'localStorage');
  assert.deepEqual(cache.read().data, payload.data);
  env.localStorage.setItem('family-backup-v1-4173', '{broken');
  assert.equal(cache.read(), null);
  env.localStorage.setItem('family-backup-v1-4173', JSON.stringify({ ...payload, savedAt: 0 }));
  assert.equal(cache.read(), null);
  assert.equal(Storage.create(environment({ cookies: false, storage: false }), Model.build).save(payload), null);
});
