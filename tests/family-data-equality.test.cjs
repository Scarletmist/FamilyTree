const test = require('node:test');
const assert = require('node:assert/strict');
const Model = require('../assets/family-model.js');

test('sameJsonData ignores object key order but preserves array/content changes', () => {
  const a = {
    schemaVersion: 2,
    familyName: '陳氏家族',
    people: [{ id: 'p1', name: '甲', relationships: [], gender: 'U', location: '', position: '', siblingOrder: null }]
  };
  const b = {
    people: [{ position: '', relationships: [], name: '甲', siblingOrder: null, id: 'p1', location: '', gender: 'U' }],
    familyName: '陳氏家族',
    schemaVersion: 2
  };
  assert.equal(Model.sameJsonData(a, b), true);
  assert.equal(Model.sameJsonData(a, { ...b, familyName: '王氏家族' }), false);
  assert.equal(Model.sameJsonData(a, { ...b, people: [...b.people, { ...b.people[0], id: 'p2', name: '乙' }] }), false);
});
