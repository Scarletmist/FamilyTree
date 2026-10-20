const test = require('node:test');
const assert = require('node:assert/strict');
const Model = require('../src/assets/family-model');
const Projection = require('../src/assets/family-display-projection');
const p = (id, relationships = []) => ({ id, name: id, location: '', position: '', gender: 'U', siblingOrder: null, relationships });
const parent = personId => ({ type: 'parent', personId, kind: '親生' });
const teacher = personId => ({ type: 'teacher', personId });
const fellow = personId => ({ type:'fellowDisciple',personId });
const levels = people => new Map(Projection.project(Model.build({ schemaVersion: 2, people })).people.map(p => [p.id, p.gen]));

test('students without family relationships follow their teacher into the next generation', () => {
  const people = [p('G'),p('T',[parent('G')]),p('A',[teacher('T')]),p('B',[teacher('T')]),
    p('C',[fellow('B')]),p('D',[fellow('C')]),p('X')];
  for (const ordered of [people,people.slice().reverse()]) {
    const g = levels(ordered);
    assert.equal(g.get('G'),1); assert.equal(g.get('T'),2);
    for (const id of ['A','B','C','D']) assert.equal(g.get(id),3);
    assert.equal(g.get('X'),1);
  }
});

test('teacher-side student records and school chains use the same generation offset', () => {
  const people = [p('G'),p('T',[parent('G'),{type:'student',personId:'A'},{type:'student',personId:'B'}]),
    p('A',[{type:'student',personId:'C'}]),p('B'),p('C')];
  for (const ordered of [people,people.slice().reverse()]) {
    const g = levels(ordered);
    assert.equal(g.get('T'),2);
    for (const id of ['A','B']) assert.equal(g.get(id),3);
    assert.equal(g.get('C'),4);
  }
});

test('school rank groups keep otherwise unplaced peers with a teacher-positioned student', () => {
  const data = {schemaVersion:3,people:[p('G'),p('T',[parent('G')]),p('A',[teacher('T')]),p('B'),p('C')],
    rankGroups:[{id:'school',name:'同門',type:'fellowDisciple',anchorId:'T',members:[{personId:'A',order:1},{personId:'B',order:2},{personId:'C',order:null}]}]};
  const original = structuredClone(data), domain = Model.build(data);
  const graph = Projection.project(domain), g = new Map(graph.people.map(person => [person.id,person.gen]));
  for (const id of ['A','B','C']) assert.equal(g.get(id),g.get('T')+1);
  assert(domain.people.every(person => person.gen === undefined),'display generations never leak into the domain graph');
  assert.deepEqual(data,original);
  assert.deepEqual(Projection.project(domain).people,graph.people,'repeated projection does not accumulate shifts');
});

test('family relationships keep teacher and students on their known rows even when school relations disagree', () => {
  const people = [p('G'),p('T',[parent('G')]),p('A',[parent('G'),teacher('T')]),
    p('B',[parent('A'),teacher('T'),fellow('A')]),p('C',[parent('B'),teacher('T'),fellow('A')]),p('D',[teacher('T')])];
  for (const ordered of [people,people.slice().reverse()]) {
    const g = levels(ordered);
    assert.equal(g.get('T'),2); assert.equal(g.get('A'),2);
    assert.equal(g.get('B'),3); assert.equal(g.get('C'),4);
    assert.equal(g.get('D'),3,'a student without relatives still follows the teacher');
  }
});

test('spouses, siblings and cousins take precedence over a teacher-student generation gap', () => {
  for (const type of ['spouse','sibling','swornSibling','tangCousin','biaoCousin']) {
    const g = levels([p('T'),p('A',[teacher('T'),{type,personId:'T'}]),p('B',[teacher('T')])]);
    assert.equal(g.get('A'),g.get('T'),type);
    assert.equal(g.get('B'),g.get('T')+1,type);
  }
});

test('adding and removing a family premise recalculates temporary school generations', () => {
  const people = [p('G'),p('T',[parent('G')]),p('A',[teacher('T')]),p('B',[teacher('T')])];
  assert.equal(levels(people).get('A'),3);
  const changed = people.map(person => person.id === 'A' ? {...person,relationships:[...person.relationships,parent('G')]} : person);
  assert.equal(levels(changed).get('A'),2);
  assert.equal(levels(changed).get('B'),3);
  assert.equal(levels(people).get('A'),3);
});
test('unanchored teacher is above an anchored student; unrelated members stay put', () => {
  const g = levels([p('G'), p('P', [parent('G')]), p('S', [parent('P'), teacher('T')]), p('T'), p('X')]);
  assert.equal(g.get('S') - g.get('T'), 1);
  assert.equal(g.get('P') - g.get('G'), 1);
  assert.equal(g.get('X'), 1);
});
test('generation-one students and mentor chains remain positive and ordered', () => {
  for (const people of [[p('S', [teacher('T')]), p('T', [teacher('U')]), p('U')], [p('U'), p('T', [teacher('U')]), p('S', [teacher('T')])]]) {
    const g = levels(people);
    assert.equal(g.get('U'), 1); assert.equal(g.get('T'), 2); assert.equal(g.get('S'), 3);
  }
});
test('family relationships on both sides take precedence over mentorship', () => {
  const g = levels([p('G'), p('T', [parent('G')]), p('S', [parent('G'), teacher('T')])]);
  assert.equal(g.get('T'), g.get('S'));
});
test('moving a generation-one student preserves its descendants and excludes unrelated families', () => {
  const g = levels([p('S', [teacher('T')]), p('C', [parent('S')]), p('T'), p('X'), p('Y', [parent('X')])]);
  assert.equal(g.get('T'), 1); assert.equal(g.get('S'), 2); assert.equal(g.get('C'), 3);
  assert.equal(g.get('X'), 1); assert.equal(g.get('Y'), 2);
});

test('adding a teachers father and cousin branch preserves placement of the whole branch', () => {
  const base = [p('G'), p('P', [parent('G')]), p('Q', [parent('P')]), p('S', [parent('Q'), teacher('B1')]), p('B1')];
  assert.equal(levels(base).get('B1'), 3);
  const expanded = [...base, p('B0', [{ type: 'child', personId: 'B1', kind: '親生' }]),
    p('D0', [{ type: 'sibling', personId: 'B0' }]), p('D1', [parent('D0'), { type: 'tangCousin', personId: 'B1' }]),
    p('D2', [parent('D0'), { type: 'tangCousin', personId: 'B1' }])];
  // Use a longer established family, as in the user's dataset.
  expanded.push(p('R', [parent('Q')]), p('U', [parent('P')]));
  for (const people of [expanded, expanded.slice().reverse()]) {
    const g = levels(people);
    for (const id of ['B0', 'D0']) assert.equal(g.get(id), 2);
    for (const id of ['B1', 'D1', 'D2']) assert.equal(g.get(id), 3);
    assert.equal(g.get('S'), 4); assert.equal(g.get('G'), 1);
    const plans = Projection.intermediatePlans({ schemaVersion: 2, people });
    assert.equal(plans.find(plan => plan.relationships.some(r => r.personId === 'B0')).generation, 1);
  }
});
