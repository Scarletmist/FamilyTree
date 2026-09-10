const test = require('node:test');
const assert = require('node:assert/strict');
const Model = require('../assets/family-model');
const p = (id, relationships = [], gender = 'M') => ({ id, name: id, gender, location: '', position: '', siblingOrder: null, relationships });
const child = personId => ({ type: 'child', personId, kind: '親生' });
test('adding a father aligns both cousin branches even when the other branch is already anchored', () => {
  const data = { schemaVersion: 2, people: [p('G', [child('P')]), p('P', [child('B')]), p('B'), p('A', [{ type: 'tangCousin', personId: 'B' }]), p('C', [child('A')])] };
  const byId = new Map(Model.build(data).people.map(p => [p.id, p]));
  assert.equal(byId.get('A').gen, byId.get('B').gen);
  assert.equal(byId.get('C').gen, byId.get('A').gen - 1);
});
test('completed cousin paths hide only matching biological shortcuts and remain reversible', () => {
  for (const [type, kind, gender] of [['tangCousin', '堂親', 'M'], ['biaoCousin', '表親', 'F']]) {
    const data = { schemaVersion: 2, people: [p('A', [{ type, personId: 'B' }]), p('B'), p('C', [child('A')]), p('D', [child('B'), { type: 'sibling', personId: 'C' }], gender)] };
    assert(Model.completedCousins(Model.build(data)).has(Model.intermediateKey(kind, ['A', 'B'])));
    data.people[3].relationships.pop();
    assert.equal(Model.completedCousins(Model.build(data)).size, 0);
    data.people.push(p('G', [child('C'), child('D')]));
    assert.equal(Model.completedCousins(Model.build(data)).size, 1);
    data.people[2].relationships[0].kind = '養子女';
    assert.equal(Model.completedCousins(Model.build(data)).size, 0);
  }
});
test('rank one determines eldest sibling even when the other rank is blank', () => {
  const Details = require('../assets/relationship-details');
  const first = { ...p('A'), siblingOrder: 1 }, unknown = p('B', [], 'F');
  assert.equal(Details.siblingRole(first, unknown), '長兄');
  assert.equal(Details.siblingRole(unknown, first), '妹');
  assert.equal(Details.siblingRole({ ...first, gender: 'F' }, unknown), '長姊');
  assert.equal(Details.siblingRole({ ...first, siblingOrder: 3 }, unknown), '手足（長幼待確認）');
  assert.equal(Details.siblingRole({ ...unknown, siblingOrder: 2 }, first), '二妹');
});
test('cousin slots progress from two parents to one, preserving the direct cousin record', () => {
  const data = { schemaVersion: 2, people: [p('A'), p('B', [{ type: 'tangCousin', personId: 'A', seniority: 'older' }])] };
  const original = JSON.stringify(data);
  let plans = Model.intermediatePlans(data);
  assert.equal(JSON.stringify(data), original);
  assert.equal(plans.length, 2);
  assert.deepEqual(plans.find(p => p.near === 'A').relationships, [child('A')]);
  data.people.push(p('C', plans.find(p => p.near === 'A').relationships));
  plans = Model.intermediatePlans(data);
  assert.equal(plans.length, 1);
  assert.equal(plans[0].near, 'B'); assert.equal(plans[0].knownOther, 'C');
  assert.deepEqual(plans[0].choices[0].relationship, { type: 'sibling', personId: 'C' });
  data.people.push(p('D', [...plans[0].relationships, plans[0].choices[0].relationship]));
  assert.equal(Model.intermediatePlans(data).filter(p => p.edgeKey.startsWith('堂親')).length, 0);
  assert.deepEqual(data.people[1].relationships, JSON.parse(original).people[1].relationships);
  // A shared biological grandparent can now be filled between the two fathers.
  assert.deepEqual(Model.intermediatePlans(data)[0].relationships, [child('C'), child('D')]);
});
test('biao parent candidates stay explicit; non-biological parents are never sibling candidates', () => {
  const data = { schemaVersion: 2, people: [p('A'), p('B', [{ type: 'biaoCousin', personId: 'A' }]), p('C', [child('A')]), p('D', [child('A')], 'F'), p('E', [{ ...child('A'), kind: '養子女' }])] };
  const plan = Model.intermediatePlans(data)[0];
  assert.equal(plan.near, 'B'); assert.equal(plan.knownOther, null);
  assert.deepEqual(plan.choices.map(c => c.personId), ['C', 'D']);
  assert.equal(plan.gender, 'U');
});
test('biological grandparents offer a middle parent and completed paths remove the slot', () => {
  const data = { schemaVersion: 2, people: [p('G', [{ type: 'grandchild', personId: 'C', kind: '親生' }]), p('C')] };
  const plan = Model.intermediatePlans(data)[0];
  assert.deepEqual(plan.relationships, [child('C'), { type: 'parent', personId: 'G', kind: '親生' }]);
  data.people.push(p('P', plan.relationships));
  assert.deepEqual(Model.intermediatePlans(data), []);
});
test('social and adoptive relations never produce intermediate slots', () => {
  for (const kind of ['契子女', '義子女', '養子女', '過繼']) {
    assert.deepEqual(Model.intermediatePlans({ schemaVersion: 2, people: [p('G', [{ type: 'grandchild', personId: 'C', kind }]), p('C')] }), []);
  }
  for (const type of ['swornSibling', 'fellowDisciple', 'teacher', 'spouse']) {
    assert.deepEqual(Model.intermediatePlans({ schemaVersion: 2, people: [p('A', [{ type, personId: 'B' }]), p('B')] }), []);
  }
});
test('known shared parents suppress sibling slots, and reverse records are equivalent', () => {
  const data = { schemaVersion: 2, people: [p('A', [{ type: 'sibling', personId: 'B' }]), p('B')] };
  assert.deepEqual(Model.intermediatePlans(data)[0].relationships, [child('A'), child('B')]);
  data.people.push(p('P', [child('A'), child('B')]));
  assert.deepEqual(Model.intermediatePlans(data), []);
});
