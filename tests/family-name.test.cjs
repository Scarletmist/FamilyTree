const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const Model = require('../assets/family-model.js');
const { createFamilyServer } = require('../server.cjs');
const demo = require('../data/family.json');

async function fixture(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'family-name-test-'));
  const dataFile = path.join(dir, 'family.json');
  await fs.writeFile(dataFile, JSON.stringify(demo, null, 2) + '\n');
  let server = createFamilyServer({ dataFile });
  const start = async () => { await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); return `http://127.0.0.1:${server.address().port}`; };
  let base = await start();
  const read = async () => (await fetch(base + '/api/family')).json();
  const send = (route, method, body, origin = base) => fetch(base + route, { method, headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(body) });
  try { await fn({ dataFile, read, send, getBase: () => base, restart: async () => { await new Promise(resolve => server.close(resolve)); server = createFamilyServer({ dataFile }); base = await start(); } }); }
  finally { await new Promise(resolve => server.close(resolve)); await fs.rm(dir, { recursive: true, force: true }); }
}

test('legacy schema v2 has a display default; explicit names are validated without changing people', () => {
  assert.equal(Model.build(demo).familyName, '陳氏家族');
  assert.equal(Model.normalizeFamilyName('  林氏宗親  '), '林氏宗親');
  assert.equal(Model.build({ ...demo, familyName: '林氏宗親' }).familyName, '林氏宗親');
  for (const value of ['', '  ', 'a'.repeat(81), null, 12, {}, 'A\nB', 'A\u0000B']) {
    assert.throws(() => Model.build({ ...demo, familyName: value }), /家族名稱/);
  }
  assert.equal(JSON.stringify(demo.people), JSON.stringify(Model.build(demo).people.map(({ gen, ...p }) => p)));
});

test('family name API persists atomically, survives restart and preserves members and metadata', async () => fixture(async ({ dataFile, read, send, restart }) => {
  const first = await read();
  assert.equal(first.data.familyName, undefined);
  const originalPeople = structuredClone(first.data.people);
  const response = await send('/api/family/name', 'PUT', { familyName: '  林氏家族  ', version: first.version });
  assert.equal(response.status, 200);
  const saved = await response.json();
  assert.equal(saved.data.familyName, '林氏家族');
  assert.deepEqual(saved.data.people, originalPeople);
  assert.equal(JSON.parse(await fs.readFile(dataFile, 'utf8')).familyName, '林氏家族');
  assert.deepEqual(await (await send('/api/family/name', 'PUT', { familyName: '林氏家族', version: saved.version })).json(), saved);
  const existing = await fs.readFile(dataFile, 'utf8');
  assert.equal((await send('/api/family/name', 'PUT', { familyName: '  ', version: saved.version })).status, 400);
  assert.equal((await send('/api/family/name', 'PUT', { familyName: '舊版本', version: first.version })).status, 409);
  assert.equal(await fs.readFile(dataFile, 'utf8'), existing);
  assert.equal((await send('/api/family/name', 'PUT', { familyName: '攻擊', version: saved.version }, 'https://example.com')).status, 403);
  assert.equal((await send('/api/family/name', 'PUT', { version: saved.version })).status, 400);
  assert.equal((await send('/api/family/name', 'PUT', { familyName: null, version: saved.version })).status, 400);
  assert.equal((await send('/api/family/name', 'PUT', { familyName: 'x'.repeat(81), version: saved.version })).status, 400);
  assert.equal((await send('/api/family/name', 'PUT', { familyName: '其他', version: saved.version }, undefined)).status, 200);
  const second = await read();
  assert.equal(second.data.familyName, '其他');
  await restart();
  assert.equal((await read()).data.familyName, '其他');
  assert.equal((await read()).data.people.length, originalPeople.length);
  assert.equal((await fs.readdir(path.dirname(dataFile))).filter(name => name.endsWith('.tmp')).length, 0);
}));

test('name edits share the write queue with member edits and imports; export preserves metadata', async () => fixture(async ({ read, send, getBase }) => {
  const first = await read();
  const writes = await Promise.all([
    send('/api/family/name', 'PUT', { familyName: '張氏家族', version: first.version }),
    send('/api/family/name', 'PUT', { familyName: '王氏家族', version: first.version })
  ]);
  assert.deepEqual(writes.map(r => r.status).sort(), [200, 409]);
  const saved = await read();
  assert.deepEqual(await (await fetch(getBase() + '/api/family/export')).json(), saved.data);
  const member = { ...saved.data.people[0], name: '修改姓名' };
  const edited = await send('/api/members/' + member.id, 'PUT', { member, version: saved.version });
  assert.equal(edited.status, 200);
  const changed = await edited.json();
  assert.equal(changed.data.familyName, saved.data.familyName);
  assert.equal(changed.data.people[0].name, '修改姓名');
  const imported = { ...changed.data, familyName: '匯入家族', extraMetadata: { retained: true } };
  const result = await send('/api/family/import', 'POST', { data: imported, version: changed.version });
  assert.equal(result.status, 200);
  const afterImport = await result.json();
  assert.equal(afterImport.data.familyName, '匯入家族');
  const renamed = await send('/api/family/name', 'PUT', { familyName: '保留其他欄位', version: afterImport.version });
  assert.equal(renamed.status, 200);
  assert.deepEqual((await renamed.json()).data.extraMetadata, { retained: true });
  const legacy = { schemaVersion: 2, people: [] };
  assert.equal((await send('/api/family/import', 'POST', { data: legacy, version: (await read()).version })).status, 200);
  assert.equal((await read()).data.familyName, undefined);
  assert.equal(Model.build((await read()).data).familyName, '陳氏家族');
}));
