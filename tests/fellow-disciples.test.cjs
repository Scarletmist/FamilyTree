const test = require('node:test');
const assert = require('node:assert/strict');
const Model = require('../assets/family-model');
const Details = require('../assets/relationship-details');
const Kinship = require('../assets/kinship').create(require('../data/kinship-terms.json'));
const p = (id, relationships = []) => ({ id, name: id, gender: 'U', location: '', position: '', siblingOrder: null, relationships });
const parent = personId => ({ type: 'parent', personId, kind: '親生' });
const fellow = personId => ({ type: 'fellowDisciple', personId });
test('fellow disciples inherit an anchored peer generation without moving anchored relatives', () => {
  const data = { schemaVersion: 2, people: [p('G'), p('P', [parent('G')]), p('S', [parent('P')]), p('F', [fellow('S')]), p('H', [fellow('F')])] };
  const graph = Model.build(data);
  assert.deepEqual(graph.people.map(p => p.gen), [1, 2, 3, 3, 3]);
  assert.equal(Kinship.query(graph, 'F', 'S').paths[0].title, '師兄弟姊妹');
  assert.equal(Details.buildGroups(graph, 'S').at(-1).id, 'fellowDisciples');
  assert.deepEqual(Model.relationshipsFor(data, 'S').find(r => r.type === 'fellowDisciple'), fellow('F'));
  assert.equal(Model.build(Model.replaceMember(data, { ...data.people[3], relationships: [] })).bonds.length, 0);
});
test('anchored fellow disciples keep different family generations; isolated peers align', () => {
  const graph = Model.build({ schemaVersion: 2, people: [p('G'), p('S', [parent('G'), fellow('G')]), p('A', [fellow('B')]), p('B')] });
  assert.deepEqual(graph.people.map(p => p.gen), [1, 2, 1, 1]);
});
test('notes remain optional for old JSON and validated when present', () => {
  Model.validateMember(p('A'));
  assert.throws(() => Model.validateMember({ ...p('A'), notes: 123 }), /備註/);
  assert.throws(() => Model.validateMember({ ...p('A'), notes: 'x'.repeat(5001) }), /備註/);
  assert.equal(Model.build({ schemaVersion: 2, people: [{ ...p('A'), notes: '逐行\n文字' }] }).people[0].notes, '逐行\n文字');
});

test('numeric school order uses target gender and survives reverse editing and projection', () => {
  const data = { schemaVersion: 2, people: [{ ...p('A'), gender: 'F', discipleOrder: 4, siblingOrder: 1, relationships: [fellow('B')] }, { ...p('B'), gender: 'M', discipleOrder: 1, siblingOrder: 4 }] };
  let graph = Model.build(data);
  assert.equal(Kinship.query(graph, 'B', 'A').paths[0].title, '師兄');
  assert.equal(Kinship.query(graph, 'A', 'B').paths[0].title, '師妹');
  assert.equal(Details.buildGroups(graph, 'A')[0].entries[0].role, '師兄');
  assert.equal(Details.buildGroups(graph, 'B')[0].entries[0].role, '師妹');
  const inverse = Model.relationshipsFor(data, 'B');
  assert.deepEqual(inverse, [fellow('A')]);
  const edited = Model.replaceMember(data, { ...data.people[1], relationships: inverse });
  graph = Model.build(edited);
  assert.equal(Kinship.query(graph, 'A', 'B').paths[0].title, '師妹');
  const path = Kinship.query(graph, 'B', 'A').paths[0];
  assert.equal(Kinship.query(Kinship.project(graph, path), 'B', 'A').paths[0].title, '師兄');
  edited.people[0].gender = 'M'; edited.people[1].gender = 'F'; graph = Model.build(edited);
  assert.equal(Kinship.query(graph, 'B', 'A').paths[0].title, '師姊');
  assert.equal(Kinship.query(graph, 'A', 'B').paths[0].title, '師弟');
});

test('school order validates duplicates and ignores legacy seniority', () => {
  const data = { schemaVersion: 2, people: [{ ...p('A', [{ ...fellow('B'), seniority: 'older' }]), discipleOrder: 1 }, { ...p('B'), discipleOrder: 1 }] };
  assert.throws(() => Model.build(data), /師門內的次序重複/);
  data.people[1].discipleOrder = 4;
  assert.equal(Kinship.query(Model.build(data), 'B', 'A').paths[0].title, '年幼同門');
  data.people[1].discipleOrder = null;
  assert.equal(Kinship.query(Model.build(data), 'B', 'A').paths[0].title, '師兄弟姊妹');
  for (const value of [0, -1, 1.2, '2', 1000]) assert.throws(() => Model.validateMember({ ...p('X'), discipleOrder: value }), /師門次序/);
});
test('shared teacher uses school order; independent schools may repeat ranks', () => {
  const data = { schemaVersion: 2, people: [p('T'), { ...p('A', [{ type: 'teacher', personId: 'T' }]), gender: 'M', discipleOrder: 1 }, { ...p('B', [{ type: 'teacher', personId: 'T' }]), gender: 'F', discipleOrder: 3 }, { ...p('X'), discipleOrder: 1 }] };
  const graph = Model.build(data);
  assert.equal(Kinship.query(graph, 'A', 'B').paths[0].title, '師兄');
  assert.equal(Kinship.query(graph, 'B', 'A').paths[0].title, '師妹');
  assert.equal(Details.buildGroups(graph, 'A').find(g => g.id === 'fellowDisciples').entries[0].role, '師妹');
  data.people[2].discipleOrder = 1; assert.throws(() => Model.build(data), /師門內的次序重複/);
});
