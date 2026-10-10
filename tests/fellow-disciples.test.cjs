const test = require('node:test');
const assert = require('node:assert/strict');
const Model = require('../src/assets/family-model');
const Projection = require('../src/assets/family-display-projection');
const Details = require('../src/assets/relationship-details');
const Kinship = require('../src/assets/kinship').create(require('../src/data/kinship-terms.json'));
const p = (id, relationships = []) => ({ id, name: id, gender: 'U', location: '', position: '', siblingOrder: null, relationships });
const parent = personId => ({ type: 'parent', personId, kind: '親生' });
const fellow = personId => ({ type: 'fellowDisciple', personId });
test('fellow disciples inherit an anchored peer generation without moving anchored relatives', () => {
  const data = { schemaVersion: 2, people: [p('G'), p('P', [parent('G')]), p('S', [parent('P')]), p('F', [fellow('S')]), p('H', [fellow('F')])] };
  const graph = Projection.project(Model.build(data));
  assert.deepEqual(graph.people.map(p => p.gen), [1, 2, 3, 3, 3]);
  assert.equal(Kinship.query(graph, 'F', 'S').paths[0].title, '師兄弟姊妹');
  assert.equal(Details.buildGroups(graph, 'S').at(-1).id, 'fellowDisciples');
  assert.deepEqual(Model.relationshipsFor(data, 'S').find(r => r.type === 'fellowDisciple'), fellow('F'));
  assert.equal(Model.build(Model.replaceMember(data, { ...data.people[3], relationships: [] })).bonds.length, 0);
});
test('anchored fellow disciples keep different family generations; isolated peers align', () => {
  const graph = Projection.project(Model.build({ schemaVersion: 2, people: [p('G'), p('S', [parent('G'), fellow('G')]), p('A', [fellow('B')]), p('B')] }));
  assert.deepEqual(graph.people.map(p => p.gen), [1, 2, 1, 1]);
});
test('a parent without known ancestors aligns with a fellow disciple and moves its whole family branch', () => {
  for (const reverseRelation of [false, true]) {
    const people = [p('G'), p('P', [parent('G')]), p('C', [parent('P'), ...(reverseRelation ? [fellow('A')] : [])]),
      p('A', reverseRelation ? [] : [fellow('C')]), p('B', [parent('A')]), p('D', [parent('B')]),
      p('S', [{ type: 'spouse', personId: 'A' }]), p('X'), p('Y', [parent('X')])];
    for (const ordered of [people, people.slice().reverse()]) {
      const data = { schemaVersion: 2, people: ordered }, original = JSON.stringify(data);
      const generations = new Map(Projection.project(Model.build(data)).people.map(person => [person.id, person.gen]));
      assert.deepEqual(Object.fromEntries(['G', 'P', 'C', 'A', 'B', 'D', 'S', 'X', 'Y'].map(id => [id, generations.get(id)])),
        { G: 1, P: 2, C: 3, A: 3, B: 4, D: 5, S: 3, X: 1, Y: 2 });
      assert.equal(JSON.stringify(data), original, 'display placement must not invent or modify family relationships');
    }
  }
});

test('an unanchored parent inherits a known generation through a chain of fellow disciples', () => {
  const people = [p('G'), p('P', [parent('G')]), p('C', [parent('P')]), p('F', [fellow('C')]),
    p('A', [fellow('F')]), p('B', [parent('A')])];
  for (const ordered of [people, people.slice().reverse()]) {
    const graph = Projection.project(Model.build({ schemaVersion: 2, people: ordered }));
    for (const id of ['C', 'F', 'A']) assert.equal(graph.people.find(person => person.id === id).gen, 3);
    assert.equal(graph.people.find(person => person.id === 'B').gen, 4);
  }
});

test('multiple known fellow disciples keep their own generations and the earlier generation guides an unknown branch', () => {
  const people = [p('G'), p('P', [parent('G')]), p('C', [parent('P')]),
    p('A', [fellow('C'), fellow('P')]), p('B', [parent('A')])];
  for (const ordered of [people, people.slice().reverse()]) {
    const generations = new Map(Projection.project(Model.build({ schemaVersion: 2, people: ordered })).people.map(person => [person.id, person.gen]));
    assert.equal(generations.get('P'), 2);
    assert.equal(generations.get('C'), 3);
    assert.equal(generations.get('A'), 2);
    assert.equal(generations.get('B'), 3);
  }
});

test('a descendants fellow-disciple link follows the branch after its root is aligned', () => {
  const people = [p('G'), p('P', [parent('G')]), p('C', [parent('P')]), p('F', [fellow('C')]),
    p('A', [fellow('F')]), p('B', [parent('A'), fellow('H')]), p('H')];
  for (const ordered of [people, people.slice().reverse()]) {
    const generations = new Map(Projection.project(Model.build({ schemaVersion: 2, people: ordered })).people.map(person => [person.id, person.gen]));
    for (const id of ['C', 'F', 'A']) assert.equal(generations.get(id), 3);
    for (const id of ['B', 'H']) assert.equal(generations.get(id), 4);
  }
});

test('new ancestors take precedence over the temporary fellow-disciple placement', () => {
  let data = { schemaVersion: 2, people: [p('G'), p('P', [parent('G')]), p('C', [parent('P')]),
    p('A', [fellow('C')]), p('B', [parent('A')])] };
  assert.equal(Projection.project(Model.build(data)).people.find(person => person.id === 'A').gen, 3);
  data.people.push(p('D', [{ type: 'child', personId: 'A', kind: '親生' }]));
  for (const ordered of [data.people, data.people.slice().reverse()]) {
    const generations = new Map(Projection.project(Model.build({ ...data, people: ordered })).people.map(person => [person.id, person.gen]));
    assert.equal(generations.get('D'), 1);
    assert.equal(generations.get('A'), 2);
    assert.equal(generations.get('B'), 3);
    assert.equal(generations.get('C'), 3);
  }
  data = Model.replaceMember(data, { ...data.people.find(person => person.id === 'D'), relationships: [] });
  assert.equal(Projection.project(Model.build(data)).people.find(person => person.id === 'A').gen, 3);
});

test('a parent can follow a mentor-positioned fellow disciple without changing either hierarchy', () => {
  const people = [p('T'), p('C', [{ type: 'teacher', personId: 'T' }]), p('A', [fellow('C')]), p('B', [parent('A')])];
  for (const ordered of [people, people.slice().reverse()]) {
    const generations = new Map(Projection.project(Model.build({ schemaVersion: 2, people: ordered })).people.map(person => [person.id, person.gen]));
    assert.equal(generations.get('T'), 1);
    assert.equal(generations.get('C'), 2);
    assert.equal(generations.get('A'), 2);
    assert.equal(generations.get('B'), 3);
  }
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
