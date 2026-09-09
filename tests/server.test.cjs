const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const { createFamilyServer } = require('../server.cjs');
const Model = require('../assets/family-model.js');
const demo = require('../data/family.json');
const person = (id, relationships = [], siblingOrder = null) => ({ id, name: id, location: '', position: '', gender: 'U', siblingOrder, relationships });

test('numeric ordering and relationship-derived generations', () => {
  const graph = Model.build(demo);
  const byId = new Map(graph.people.map(p => [p.id, p]));
  assert.equal(byId.get('p24').gen, byId.get('p11').gen);
  assert.equal(byId.get('p24').gen, 3);
  assert.equal(Model.compareOrder(byId.get('p7'), byId.get('p12')), -1);
  assert.equal(Model.compareOrder(byId.get('p24'), byId.get('p12')), 0);
  assert(demo.people.every(p => !('birth' in p) && !('death' in p) && !('gen' in p)));
});

test('single parents, shared parents without marriage, reverse child relation and standalone members', () => {
  const data = { schemaVersion: 2, people: [person('A', [{ type: 'child', personId: 'C', kind: '親生' }]), person('B'), person('C', [{ type: 'parent', personId: 'B', kind: '親生' }], 1), person('D', [{ type: 'parent', personId: 'A', kind: '親生' }], 2), person('E')] };
  const graph = Model.build(data);
  assert.equal(graph.unions.length, 2);
  assert(graph.unions.every(u => !u.married));
  assert(graph.unions.some(u => u.partners.length === 1));
  assert.equal(graph.people.find(p => p.id === 'C').gen, 2);
  assert.equal(graph.people.find(p => p.id === 'E').gen, 1);
});

test('reject cycles, bad references, duplicate numeric rank and duplicate form relations', () => {
  assert.throws(() => Model.build({ schemaVersion: 2, people: [person('A', [{ type: 'parent', personId: 'B', kind: '親生' }]), person('B', [{ type: 'parent', personId: 'A', kind: '親生' }])] }), /矛盾/);
  assert.throws(() => Model.build({ schemaVersion: 2, people: [person('A', [{ type: 'spouse', personId: 'missing' }])] }), /不存在/);
  assert.throws(() => Model.build({ schemaVersion: 2, people: [person('A'), person('B', [{ type: 'parent', personId: 'A', kind: '親生' }], 1), person('C', [{ type: 'parent', personId: 'A', kind: '親生' }], 1)] }), /次序重複/);
  assert.throws(() => Model.validateMember(person('A', [{ type: 'teacher', personId: 'B' }, { type: 'teacher', personId: 'B' }])), /重複/);
  assert.throws(() => Model.validateMember(person('A', [], 1.5)), /整數/);
});

test('API saves JSON, survives restart, prevents lost updates and handles retries', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'family-tree-test-'));
  const dataFile = path.join(directory, 'family.json');
  await fs.writeFile(dataFile, JSON.stringify(demo));
  let server = createFamilyServer({ dataFile });
  async function start() { await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); return `http://127.0.0.1:${server.address().port}`; }
  let base = await start();
  const read = async () => (await fetch(base + '/api/family')).json();
  const post = body => fetch(base + '/api/members', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify(body) });
  try {
    const first = await read();
    const body = { version: first.version, requestId: randomUUID(), member: { name: '儲存測試', location: '臺中市', position: '教師', gender: 'F', siblingOrder: 7, relationships: [{ type: 'parent', personId: 'p11', kind: '親生' }, { type: 'parent', personId: 'p15', kind: '親生' }, { type: 'teacher', personId: 'p24' }] } };
    const response = await post(body);
    assert.equal(response.status, 201);
    const saved = await response.json();
    const disk = JSON.parse(await fs.readFile(dataFile, 'utf8'));
    const member = disk.people.find(p => p.id === saved.memberId);
    assert.equal(member.location, '臺中市'); assert.equal(member.position, '教師'); assert.equal(member.siblingOrder, 7); assert.equal(member.relationships.length, 3);
    assert.equal((await post(body)).status, 200, 'Retry is idempotent');
    assert.equal((await post({ ...body, requestId: randomUUID() })).status, 409, 'Stale snapshot cannot overwrite a save');
    const beforeInvalid = await fs.readFile(dataFile, 'utf8');
    assert.equal((await post({ ...body, version: saved.version, requestId: randomUUID(), member: { ...body.member, siblingOrder: 2 } })).status, 400);
    assert.equal(await fs.readFile(dataFile, 'utf8'), beforeInvalid, 'Rejected request leaves JSON intact');
    const concurrent = await Promise.all([1, 2].map(i => post({ version: saved.version, requestId: randomUUID(), member: { name: `並行${i}`, location: '', position: '', gender: 'U', siblingOrder: null, relationships: [] } })));
    assert.deepEqual(concurrent.map(r => r.status).sort(), [201, 409]);
    assert.equal((await fs.readdir(directory)).filter(name => name.endsWith('.tmp')).length, 0);
    assert.equal((await fetch(base + '/api/members', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://example.com' }, body: '{}' })).status, 403);
    assert.equal((await fetch(base + '/.git/config')).status, 404);
    await new Promise(resolve => server.close(resolve));
    server = createFamilyServer({ dataFile }); base = await start();
    assert((await read()).data.people.some(p => p.id === saved.memberId), 'Data survives a server restart');
  } finally {
    await new Promise(resolve => server.close(resolve));
    await fs.unlink(dataFile); await fs.rmdir(directory);
  }
});

test('edit reconciles inverse relationships; import/export round trips with backup and validation', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'family-edit-test-'));
  const dataFile = path.join(directory, 'family.json');
  await fs.writeFile(dataFile, JSON.stringify(demo));
  const server = createFamilyServer({ dataFile });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const read = async () => (await fetch(base + '/api/family')).json();
  const send = (route, method, body) => fetch(base + route, { method, headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify(body) });
  try {
    assert.match(await (await fetch(base)).text(), /id="import-json"/);
    const oldHome = await fetch(base + '/index.html', { redirect: 'manual' });
    assert.equal(oldHome.status, 301); assert.equal(oldHome.headers.get('location'), '/');
    const exportResponse = await fetch(base + '/api/family/export');
    assert.match(exportResponse.headers.get('content-disposition'), /attachment/);
    const exported = await exportResponse.json(); assert.deepEqual(exported, demo);
    const first = await read();
    const incoming = Model.relationshipsFor(first.data, 'p11');
    assert(incoming.some(r => r.type === 'swornSibling' && r.personId === 'p24'));
    assert(incoming.some(r => r.type === 'student' && r.personId === 'p17'));
    assert(incoming.some(r => r.type === 'child' && r.personId === 'p16'));
    const member = { ...first.data.people.find(p => p.id === 'p11'), location: '臺北市', position: '經理',
      relationships: incoming.filter(r => r.type !== 'swornSibling' && r.type !== 'student' && !(r.type === 'child' && r.personId === 'p16')) };
    const response = await send('/api/members/p11', 'PUT', { member, version: first.version });
    assert.equal(response.status, 200);
    const saved = await response.json();
    assert.equal(saved.memberId, 'p11'); assert.equal(saved.data.people.length, demo.people.length);
    assert(saved.data.people.filter(p => p.id !== 'p11').every(p => p.relationships.every(r => r.personId !== 'p11')));
    assert(!Model.relationshipsFor(saved.data, 'p24').some(r => r.personId === 'p11'));
    assert(!Model.relationshipsFor(saved.data, 'p16').some(r => r.personId === 'p11'));
    assert(Model.relationshipsFor(saved.data, 'p17').some(r => r.type === 'parent' && r.personId === 'p11'));
    assert(!Model.relationshipsFor(saved.data, 'p17').some(r => r.type === 'teacher' && r.personId === 'p11'));
    assert.deepEqual(saved.data.people.find(p => p.id === 'p3'), demo.people.find(p => p.id === 'p3'));
    assert.equal((await send('/api/members/p11', 'PUT', { member, version: first.version })).status, 409);
    assert.equal((await send('/api/members/missing', 'PUT', { member, version: saved.version })).status, 404);
    assert.equal((await send('/api/members/p11', 'PUT', { member: { ...member, relationships: [{ type: 'spouse', personId: 'p11' }] }, version: saved.version })).status, 400);
    const beforeInvalid = await fs.readFile(dataFile, 'utf8');
    const invalid = structuredClone(exported); invalid.people[0].relationships.push({ type: 'teacher', personId: 'missing' });
    assert.equal((await send('/api/family/import', 'POST', { data: invalid, version: saved.version })).status, 400);
    assert.equal(await fs.readFile(dataFile, 'utf8'), beforeInvalid);
    assert.equal((await send('/api/family/import', 'POST', { data: exported, version: first.version })).status, 409);
    const imported = await send('/api/family/import', 'POST', { data: exported, version: saved.version });
    assert.equal(imported.status, 200); assert.equal((await imported.json()).backupCreated, true);
    assert.deepEqual(JSON.parse(await fs.readFile(dataFile, 'utf8')), exported);
    assert.deepEqual(JSON.parse(await fs.readFile(dataFile + '.backup.json', 'utf8')), saved.data);
    assert.deepEqual(await (await fetch(base + '/api/family/export')).json(), exported);
    const emptyResponse = await send('/api/family/import', 'POST', { data: { schemaVersion: 2, people: [] }, version: (await read()).version });
    assert.equal(emptyResponse.status, 200);
    assert.equal((await read()).data.people.length, 0);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await fs.unlink(dataFile); await fs.rm(dataFile + '.backup.json', { force: true }); await fs.rmdir(directory);
  }
});
