const test = require('node:test');
const assert = require('node:assert/strict');
const Model = require('../assets/family-model.js');

test('relationshipMemberIds includes both relation sources and targets, excluding unlinked members', () => {
  const people = [
    { id:'A', relationships:[{ type:'parent', personId:'B', kind:'親生' }] },
    { id:'B', relationships:[] },
    { id:'X', relationships:[] }
  ];
  assert.deepEqual([...Model.relationshipMemberIds(people)].sort(), ['A', 'B']);
});
