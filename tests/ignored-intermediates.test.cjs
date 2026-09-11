const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const Model = require('../assets/family-model.js');
const { createFamilyServer } = require('../server.cjs');

const person = (id, relationships = [], gender = 'U') => ({ id, name:id, location:'', position:'', gender, siblingOrder:null, relationships });
const child = id => ({ type:'child', personId:id, kind:'親生' });

function sample() {
  return { schemaVersion:2, familyName:'測試家族', people:[
    person('A', [{ type:'sibling', personId:'B' }]),
    person('B')
  ]};
}

test('ignored intermediate plans are persisted metadata and hidden from normal suggestions', () => {
  const data = sample();
  const plan = Model.intermediatePlans(data)[0];
  assert(plan);
  const ignored = { ...data, ignoredIntermediatePlans:[plan.id] };
  assert.equal(Model.intermediatePlans(ignored).length, 0);
  assert.equal(Model.intermediatePlans(ignored, { includeIgnored:true })[0].id, plan.id);
  assert.deepEqual(Model.build(ignored).ignoredIntermediatePlans, [plan.id]);
});

test('intermediate ignore API hides and restores a suggestion without altering people', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'family-ignore-'));
  const file = path.join(dir, 'family.json');
  const initial = sample();
  await fs.writeFile(file, JSON.stringify(initial, null, 2));
  const server = createFamilyServer({ dataFile:file });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await fs.rm(dir, {recursive:true, force:true}); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const read = async () => (await fetch(base + '/api/family')).json();
  const put = async body => fetch(base + '/api/family/intermediate-ignore', { method:'PUT', headers:{ 'Origin':base, 'Content-Type':'application/json' }, body:JSON.stringify(body) });
  let current = await read();
  const plan = Model.intermediatePlans(current.data)[0];
  let response = await put({ planId:plan.id, ignored:true, version:current.version });
  assert.equal(response.status, 200);
  current = await response.json();
  assert.deepEqual(current.data.people, initial.people);
  assert.deepEqual(current.data.ignoredIntermediatePlans, [plan.id]);
  assert.equal(Model.intermediatePlans(current.data).length, 0);
  response = await put({ planId:plan.id, ignored:false, version:current.version });
  assert.equal(response.status, 200);
  current = await response.json();
  assert.deepEqual(current.data.ignoredIntermediatePlans, []);
  assert.equal(Model.intermediatePlans(current.data).length, 1);
});
