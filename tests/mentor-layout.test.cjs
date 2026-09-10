const test = require('node:test');
const assert = require('node:assert/strict');
const Model = require('../assets/family-model');
const p = (id, relationships = []) => ({ id, name: id, location: '', position: '', gender: 'U', siblingOrder: null, relationships });
const parent = personId => ({ type: 'parent', personId, kind: '親生' });
const teacher = personId => ({ type: 'teacher', personId });
const levels = people => new Map(Model.build({ schemaVersion: 2, people }).people.map(p => [p.id, p.gen]));
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
    const plans = Model.intermediatePlans({ schemaVersion: 2, people });
    assert.equal(plans.find(plan => plan.relationships.some(r => r.personId === 'B0')).generation, 1);
  }
});
