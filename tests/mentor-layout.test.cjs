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
