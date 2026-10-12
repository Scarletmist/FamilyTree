const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../src/assets/relationship-evidence.js');
const M = require('../src/assets/family-model.js');
const D = require('../src/assets/relationship-details.js');
const K = require('../src/assets/kinship.js').create(require('../src/data/kinship-terms.json'));
const p = (id,relationships = []) => ({ id,name:id,gender:'U',location:'',position:'',siblingOrder:null,relationships });
const parent = (personId,status) => ({type:'parent',personId,kind:'親生',...(status ? {status} : {}),source:'訪談 ' + personId});
const data = () => ({schemaVersion:3,people:[p('G'),p('P',[parent('G','confirmed')]),p('C',[parent('P','confirmed')]),p('S',[parent('P')]),p('T',[parent('P','pending')])]});
const entry = (graph,id,category,to) => D.buildGroups(graph,id).find(g => g.id === category).entries.find(e => e.personId === to);

test('detail, reverse query and original record agree on provenance without confirmation fields',() => {
  const graph = M.build(data()),resolver = E.create(graph);
  for (const [id,status] of [['C','confirmed'],['S','unmarked'],['T','pending']]) {
    const detail = entry(graph,'P','children',id).proofs[0].evidence;
    const query = K.query(graph,id,'P').paths.find(path => path.edges.length === 1);
    assert.equal(detail.origin,'direct'); assert.deepEqual(resolver.path(query.edges),detail);
    assert(!('status' in detail)); assert(!('statusLabel' in detail));
    assert.equal(resolver.between(id,'P',['parent'])[0].evidence.records[0].relation.status,status === 'unmarked' ? undefined : status);
  }
});
test('grandparent and synthesized sibling evidence evaluates the actual premises',() => {
  const graph = M.build(data()),resolver = E.create(graph);
  assert.equal(entry(graph,'C','grandparents','G').proofs[0].evidence.origin,'inferred');
  assert.equal(entry(graph,'C','siblings','S').proofs[0].evidence.premises.length,2);
  const pending = entry(graph,'C','siblings','T').proofs[0].evidence;
  assert.equal(pending.originLabel,'推導');
  assert.equal(pending.premises[1].records[0].ownerId,'T');
  assert.equal(resolver.path(K.query(graph,'T','G').paths[0].edges).premises.length,2);
  assert(graph.inferredRelations.some(r => r.from === 'T' && r.personId === 'G'),'legacy flags no longer suppress automatic inference');
});
test('separate parents and different relation types retain separate evidence on a shared line',() => {
  const graph = M.build({schemaVersion:3,people:[p('A'),p('B'),p('C',[parent('A','confirmed'),parent('B','pending'),{type:'teacher',personId:'A'}])]});
  const resolver = E.create(graph);
  assert.equal(resolver.between('C','A',['parent'])[0].evidence.records[0].relation.source,'訪談 A');
  assert.equal(resolver.between('C','B',['parent'])[0].evidence.records[0].relation.source,'訪談 B');
  assert.deepEqual(resolver.between('C','A').map(item => item.relation.type),['parent','teacher']);
});
test('evidence updates after editing source and does not mutate records or inference',() => {
  const source = data(),before = structuredClone(source);
  E.create(M.build(source)).between('C','S',['sibling']); assert.deepEqual(source,before);
  source.people.find(p => p.id === 'S').relationships[0].source = '更新來源';
  const proof = entry(M.build(source),'C','siblings','S').proofs[0].evidence;
  assert(proof.records.some(r => r.relation.source === '更新來源')); assert.equal(proof.premises.length,2);
});
test('reverse legacy metadata is preserved without becoming a presentation state, and missing proof has no records',() => {
  const source = {people:[p('A',[{type:'spouse',personId:'B',status:'confirmed'}]),p('B',[{type:'spouse',personId:'A',status:'pending',source:'反向來源'}])]};
  const proof = E.create(source).between('A','B',['spouse'])[0].evidence;
  assert(!('status' in proof)); assert.equal(proof.records.length,2);
  assert.equal(proof.records[1].relation.source,'反向來源');
  assert.equal(E.create(source).path([{from:'A',to:'missing',type:'parent',kind:'親生',status:'confirmed'}]).records.length,0);
});

test('legacy flags do not block duplicate-member merges while source conflicts still do',() => {
  const source = {schemaVersion:3,people:[p('P'),p('A',[parent('P','confirmed')]),p('B',[parent('P','pending')])]};
  const merged = M.mergeMembers(source,'A','B');
  assert.equal(merged.people.find(p => p.id === 'A').relationships.length,1);
  assert.equal(source.people.find(p => p.id === 'B').relationships[0].status,'pending');
  source.people.find(p => p.id === 'B').relationships[0].source = '不同來源';
  assert.throws(() => M.mergeMembers(source,'A','B'),/來源/);
});
