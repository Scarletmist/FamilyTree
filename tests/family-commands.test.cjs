const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const Commands = require('../src/assets/family-commands.js');
const Model = require('../src/assets/family-model.js');

const person = (id, relationships = []) => ({
  id, name: id, location: '', position: '', gender: 'U', siblingOrder: null, relationships
});
const base = () => ({ schemaVersion: 2, familyName: '測試家族', customMetadata: { keep: true }, people: [person('A')] });

test('addMember is deterministic and preserves unrelated root metadata', () => {
  const data = base();
  const requestId = randomUUID();
  const member = { name: ' B ', location: ' 臺北 ', position: ' 工程師 ', gender: 'U', siblingOrder: null, relationships: [] };
  const change = Commands.apply(data, { type: 'addMember', requestId, member });
  assert.equal(change.memberId, 'p-' + requestId);
  assert.equal(change.data.people.length, 2);
  assert.equal(change.data.people[1].name, 'B');
  assert.equal(change.data.people[1].location, '臺北');
  assert.deepEqual(change.data.customMetadata, { keep: true });
  assert.equal(data.people.length, 1, 'command does not mutate the original root people array');

  const retry = Commands.apply(change.data, { type: 'addMember', requestId, member });
  assert.equal(retry.unchanged, true);
  assert.equal(retry.memberId, change.memberId);
});

test('updateMember reconciles inverse records through FamilyModel', () => {
  const data = {
    schemaVersion: 2,
    people: [
      person('A'),
      person('B', [{ type: 'parent', personId: 'A', kind: '親生' }])
    ]
  };
  const member = { ...data.people[0], name: 'A2', relationships: [] };
  const change = Commands.apply(data, { type: 'updateMember', id: 'A', member });
  assert.equal(change.data.people.find(p => p.id === 'A').name, 'A2');
  assert(change.data.people.find(p => p.id === 'B').relationships.every(r => r.personId !== 'A'));
  Model.build(change.data);
});

test('family name and import commands validate through the shared domain model', () => {
  const data = base();
  const renamed = Commands.apply(data, { type: 'updateFamilyName', familyName: ' 新家族 ' });
  assert.equal(renamed.data.familyName, '新家族');
  assert.deepEqual(renamed.data.customMetadata, { keep: true });

  assert.throws(() => Commands.apply(data, { type: 'updateFamilyName' }), /請填寫家族名稱/);
  assert.throws(() => Commands.apply(data, {
    type: 'importFamily',
    data: { schemaVersion: 2, people: [person('X', [{ type: 'teacher', personId: 'missing' }])] }
  }), /不存在/);
});
