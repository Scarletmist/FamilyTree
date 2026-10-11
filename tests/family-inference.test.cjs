const test = require('node:test');
const assert = require('node:assert/strict');
const Model = require('../src/assets/family-model.js');
const Commands = require('../src/assets/family-commands.js');
const Details = require('../src/assets/relationship-details.js');
const Kinship = require('../src/assets/kinship.js').create(require('../src/data/kinship-terms.json'));
const p = (id, gender = 'M', relationships = [], siblingOrder = null) => ({ id, name: id, gender, location: '', position: '', siblingOrder, relationships });
const parent = personId => ({ type: 'parent', personId, kind: '親生' });
const sibling = personId => ({ type: 'sibling', personId });
const family = people => ({ schemaVersion: 2, people });
const automatic = (data, from, to, type) => Model.build(data).inferredRelations.find(r => r.from === from && r.personId === to && r.type === type);
const saved = (data, from, to, type) => data.people.find(p => p.id === from).inferredRelationships?.find(r => r.personId === to && r.type === type);

for (const type of ['tangCousin', 'biaoCousin']) test(`${type}: a younger biological sibling inherits the cousin relationship without invented age`, () => {
  const data = family([p('A'), p('B', 'M', [{ type, personId: 'A', seniority: 'older' }]),
    p('C', 'M', [{ ...sibling('A'), seniority: 'older' }])]);
  for (const people of [data.people, data.people.slice().reverse()]) {
    const completed = Model.completeKinship({ ...data, people });
    assert(saved(completed, 'C', 'B', type));
    assert(saved(completed, 'B', 'C', type));
    assert.equal(saved(completed, 'C', 'B', type).seniority, undefined);
    assert.equal(Kinship.query(Model.build(completed), 'C', 'B').paths[0].title, type === 'tangCousin' ? '堂兄弟' : '表兄弟');
    assert(Kinship.query(Model.build(completed), 'C', 'B').paths[0].nodes.includes('A'), 'the original evidence remains visible');
    assert.equal(Model.completeKinship(completed), completed, 'completion is idempotent');
    assert.deepEqual(completed.people.find(p => p.id === 'A').relationships, []);
  }
  assert.equal(data.people[2].inferredRelationships, undefined, 'input is not mutated');
});

test('siblings of biological parents identify tang/biao cousins and preserve inverse records', () => {
  for (const [gender, type] of [['M', 'tangCousin'], ['F', 'biaoCousin']]) {
    const data = family([p('P'), p('Q', gender, [sibling('P')]), p('A', 'M', [parent('P')]), p('B', 'F', [parent('Q')])]);
    const completed = Model.completeKinship(data);
    assert(saved(completed, 'A', 'B', type));
    assert.equal(Details.buildGroups(Model.build(completed), 'A').find(g => g.id === 'cousins').entries[0].role, type === 'tangCousin' ? '堂姊妹' : '表姊妹');
    assert.equal(saved(completed, 'B', 'A', type).path[0].from, 'B');
  }
  const unknown = family([p('P', 'U'), p('Q', 'U', [sibling('P')]), p('A', 'M', [parent('P')]), p('B', 'M', [parent('Q')])]);
  assert.equal(automatic(unknown, 'A', 'B', 'tangCousin'), undefined);
  assert.equal(automatic(unknown, 'A', 'B', 'biaoCousin'), undefined);
});

test('paternal and maternal uncles/aunts and inverse nieces/nephews have directional roles', () => {
  for (const [parentGender, relativeGender, order, expected, inverse] of [
    ['M', 'M', 1, '伯父', '姪子'], ['M', 'M', 3, '叔父', '姪子'], ['M', 'F', 1, '姑姑', '姪子'],
    ['F', 'M', 1, '舅舅', '外甥'], ['F', 'F', 1, '阿姨', '外甥']
  ]) {
    const data = family([p('P', parentGender, [], 2), p('R', relativeGender, [sibling('P')], order), p('C', 'M', [parent('P')])]);
    const completed = Model.completeKinship(data), graph = Model.build(completed);
    assert.equal(Model.inferredRole(automatic(completed, 'C', 'R', 'uncleAunt'), graph.people.find(p => p.id === 'R')), expected);
    assert.equal(Model.inferredRole(automatic(completed, 'R', 'C', 'nephewNiece'), graph.people.find(p => p.id === 'C')), inverse);
    assert(saved(completed, 'C', 'R', 'uncleAunt'));
    assert(Details.buildGroups(graph, 'C').find(g => g.id === 'unclesAunts').entries[0].badges.includes('自動辨別'));
  }
});

test('grandparent and grandchild records identify paternal and maternal branches', () => {
  for (const [gender, grandparentRole, grandchildRole] of [['M', '祖父', '孫子'], ['F', '外祖父', '外孫']]) {
    const data = family([p('G'), p('P', gender, [parent('G')]), p('C', 'M', [parent('P')])]);
    const completed = Model.completeKinship(data), graph = Model.build(completed);
    assert(saved(completed, 'C', 'G', 'grandparent'));
    assert(saved(completed, 'G', 'C', 'grandchild'));
    assert.equal(Details.buildGroups(graph, 'C').find(g => g.id === 'grandparents').entries[0].role, grandparentRole);
    assert.equal(Details.buildGroups(graph, 'G').find(g => g.id === 'grandchildren').entries[0].role, grandchildRole);
  }
});

test('already recorded grandparents are classified without duplicate automatic records', () => {
  const data = family([p('G'), p('P', 'F', [parent('G')]), p('C', 'M', [parent('P'), { type: 'grandparent', personId: 'G', kind: '親生' }])]);
  const completed = Model.completeKinship(data);
  assert.equal(saved(completed, 'C', 'G', 'grandparent'), undefined);
  assert.equal(Kinship.query(Model.build(completed), 'G', 'C').paths[0].title, '外祖父');
  assert.equal(Details.buildGroups(Model.build(completed), 'C').find(g => g.id === 'grandparents').entries.length, 1);
});

test('removing a premise retracts automatic relations, including cached inverse records', () => {
  const completed = Model.completeKinship(family([p('A'), p('B', 'M', [{ type: 'tangCousin', personId: 'A' }]), p('C', 'M', [sibling('A')])]));
  const change = Commands.apply(completed, { type: 'updateMember', id: 'C', member: { ...completed.people[2], relationships: [] } });
  assert.equal(saved(change.data, 'C', 'B', 'tangCousin'), undefined);
  assert.equal(saved(change.data, 'B', 'C', 'tangCousin'), undefined);
  assert.deepEqual(change.data.people[1].relationships, completed.people[1].relationships);
});

test('cousins are not transitive and social or pending relations do not establish biological kinship', () => {
  const cousinChain = family([p('A', 'M', [{ type: 'tangCousin', personId: 'B' }]), p('B', 'M', [{ type: 'tangCousin', personId: 'C' }]), p('C')]);
  assert.equal(automatic(cousinChain, 'A', 'C', 'tangCousin'), undefined);
  for (const type of ['swornSibling', 'fellowDisciple', 'spouse']) {
    const data = family([p('A'), p('B', 'M', [{ type: 'tangCousin', personId: 'A' }]), p('C', 'M', [{ type, personId: 'A' }])]);
    assert.equal(automatic(data, 'C', 'B', 'tangCousin'), undefined);
  }
  for (const relation of [{ ...sibling('A'), status: 'pending' }, { ...parent('A'), kind: '養子女' }]) {
    const data = family([p('A'), p('B', 'M', [{ type: 'tangCousin', personId: 'A' }]), p('C', 'M', [relation])]);
    assert.equal(automatic(data, 'C', 'B', 'tangCousin'), undefined);
  }
});

test('known maternal half-siblings cannot inherit a paternal cousin or unspecified grandparent', () => {
  const data = family([p('F1'), p('F2'), p('M', 'F'), p('G'), p('A', 'M', [parent('F1'), parent('M'), { type: 'grandparent', personId: 'G', kind: '親生' }]),
    p('B', 'M', [{ type: 'tangCousin', personId: 'A' }]), p('C', 'M', [parent('F2'), parent('M'), sibling('A')])]);
  assert.equal(automatic(data, 'C', 'B', 'tangCousin'), undefined);
  assert.equal(automatic(data, 'C', 'G', 'grandparent'), undefined);
});

test('imported automatic records are rebuilt from current source relationships', () => {
  const data = family([{ ...p('A'), inferredRelationships: [{ type: 'tangCousin', personId: 'B', path: [] }], custom: 'preserved' }, p('B')]);
  const completed = Model.completeKinship(data);
  assert.equal(completed.people[0].inferredRelationships, undefined);
  assert.equal(completed.people[0].custom, 'preserved');
  assert.equal(Model.completeKinship(completed), completed);
});

test('a tang cousin record identifies recorded fathers as uncles but a biao record cannot guess the parent branch', () => {
  const tang = family([p('P'), p('Q'), p('A', 'M', [parent('P')]), p('B', 'M', [parent('Q'), { type: 'tangCousin', personId: 'A' }])]);
  const relation = automatic(tang, 'B', 'P', 'uncleAunt');
  assert.equal(relation.lineage, 'paternal');
  assert.deepEqual(relation.path.map(e => e.type), ['tangCousin', 'parent']);
  assert.equal(new Set([relation.from, ...relation.path.map(e => e.to)]).size, relation.path.length + 1);
  const biao = family([p('P', 'F'), p('Q'), p('A', 'M', [parent('P')]), p('B', 'M', [parent('Q'), { type: 'biaoCousin', personId: 'A' }])]);
  assert.equal(automatic(biao, 'B', 'P', 'uncleAunt'), undefined);
});

test('a full sibling inherits a proven maternal grandparent and aunt even without its own parent record', () => {
  const data = family([p('G'), p('P', 'F', [parent('G')]), p('U', 'F', [sibling('P')]),
    p('A', 'M', [parent('P')]), p('C', 'M', [sibling('A')])]);
  const completed = Model.completeKinship(data);
  assert.equal(saved(completed, 'C', 'G', 'grandparent').lineage, 'maternal');
  assert.equal(saved(completed, 'C', 'U', 'uncleAunt').lineage, 'maternal');
  assert.equal(completed.people.find(p => p.id === 'C').relationships.length, 1, 'no missing parent is invented');
});

test('a confirmed duplicate cannot turn a pending source relation into automatic evidence', () => {
  const data = family([p('A', 'M', [{ ...sibling('C'), status: 'pending' }]),
    p('B', 'M', [{ type: 'tangCousin', personId: 'A' }]), p('C', 'M', [sibling('A')])]);
  assert.equal(automatic(data, 'C', 'B', 'tangCousin'), undefined);
});

test('confirming an automatic cousin retains the manual relation after the original premise is removed', () => {
  const completed = Model.completeKinship(family([p('A'), p('B', 'M', [{ type: 'biaoCousin', personId: 'A' }]), p('C', 'M', [sibling('A')])]));
  const change = Commands.apply(completed, { type: 'updateMember', id: 'C', member: { ...completed.people[2], relationships: [{ type: 'biaoCousin', personId: 'B', seniority: 'older' }] } });
  assert.equal(saved(change.data, 'C', 'B', 'biaoCousin'), undefined);
  assert.equal(Model.relationshipsFor(change.data, 'C')[0].seniority, 'older');
  assert.equal(Kinship.query(Model.build(change.data), 'B', 'C').paths[0].title, '表兄');
});

test('a conflicting recorded cousin type stays visible alongside a proven automatic type', () => {
  const data = family([p('P'), p('Q', 'F', [sibling('P')]), p('A', 'M', [parent('P')]),
    p('B', 'M', [parent('Q'), { type: 'tangCousin', personId: 'A', seniority: 'older' }])]);
  const completed = Model.completeKinship(data);
  assert(saved(completed, 'A', 'B', 'biaoCousin'));
  const entry = Details.buildGroups(Model.build(completed), 'A').find(g => g.id === 'cousins').entries[0];
  assert.match(entry.role, /堂.*表/);
  assert(entry.badges.includes('自動辨別'));
  assert(entry.contexts.some(note => note.includes('類型不同')));
  assert.deepEqual(completed.people.find(p => p.id === 'B').relationships, data.people.find(p => p.id === 'B').relationships);
});
