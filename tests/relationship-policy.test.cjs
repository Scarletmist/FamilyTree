const test = require('node:test');
const assert = require('node:assert/strict');
const Model = require('../assets/family-model');
const Details = require('../assets/relationship-details');
const Kinship = require('../assets/kinship').create(require('../data/kinship-terms.json'));
const p = (id, gender = 'M', relationships = [], siblingOrder = null) => ({id,name:id,gender,relationships,siblingOrder,location:'',position:''});
const data = people => ({schemaVersion:2,people});
const relation = (type,personId,seniority='older') => ({type,personId,seniority});
const role = (g,base,target,type='siblings') => Details.buildGroups(g,base).find(g=>g.id===type).entries.find(e=>e.personId===target);

test('relative sibling seniority survives reverse editing, later ranks take priority, contradictory updates fail', () => {
  const initial = data([p('A'),p('B','F',[{...relation('sibling','A'),note:'家人口述',source:'訪談',status:'pending'}])]);
  let graph = Model.build(initial);
  assert.equal(role(graph,'B','A').role,'兄');
  assert.equal(Kinship.query(graph,'A','B').paths[0].title,'兄');
  const inverse = Model.relationshipsFor(initial,'A')[0];
  assert.equal(inverse.seniority,'younger'); assert.equal(inverse.source,'訪談');
  const edited = Model.replaceMember(initial,{...initial.people[0],relationships:[inverse],siblingOrder:2});
  edited.people[1].siblingOrder=3; graph=Model.build(edited);
  assert.equal(role(graph,'B','A').role,'二兄');
  assert.equal(Kinship.query(graph,'A','B').paths[0].title,'二兄');
  assert(Kinship.query(graph,'A','B').paths[0].notes.includes('此路徑包含待確認關係'));
  assert.throws(()=>Model.replaceMember(edited,{...edited.people[1],siblingOrder:1,relationships:Model.relationshipsFor(edited,'B')}),/排行和相對長幼矛盾/);
  assert.equal(edited.people[1].siblingOrder,3);
});
test('contract siblings never use birth-family ranks; scoped ranks override them',()=>{
  const d=data([p('A','M',[],9),p('B','F',[relation('swornSibling','A')],1)]);
  let graph=Model.build(d); assert.equal(role(graph,'B','A').role,'契兄');
  assert.equal(Kinship.query(graph,'A','B').paths[0].title,'契兄');
  d.rankGroups=[{id:'sworn',name:'結拜',type:'swornSibling',members:[{personId:'A',order:2},{personId:'B',order:3}]}];
  graph=Model.build(d); assert.equal(role(graph,'B','A').role,'契二兄');
  const path=Kinship.query(graph,'A','B').paths[0];
  assert.equal(Kinship.query(Kinship.project(graph,path),'A','B').paths[0].title,'契二兄');
  d.rankGroups[0].members[0].order=4; assert.throws(()=>Model.build(d),/矛盾/);
});
test('rank groups isolate multiple schools, require explicit choice for ambiguous shared groups',()=>{
  const d=data([p('A'),p('B','F',[{type:'fellowDisciple',personId:'A'}]),p('T')]);
  d.rankGroups=[{id:'one',name:'甲門',type:'fellowDisciple',anchorId:'T',members:[{personId:'A',order:1},{personId:'B',order:2}]},
    {id:'two',name:'乙門',type:'fellowDisciple',members:[{personId:'A',order:2},{personId:'B',order:1}]}];
  let graph=Model.build(d); assert(role(graph,'B','A','fellowDisciples').missing.includes('請選擇排行群組'));
  d.people[1].relationships[0].groupId='one'; graph=Model.build(d);
  assert.equal(role(graph,'B','A','fellowDisciples').role,'師兄');
  assert.equal(Kinship.query(graph,'A','B').paths[0].title,'師兄');
  assert.equal(Model.dependentRank(graph,graph.people[0],graph.people[2],'fellowDisciple'),1);
  d.rankGroups[0].members[1].order=1; assert.throws(()=>Model.build(d),/甲門.*排行重複/);
});
test('half siblings need explicit distinct other parents; adoptive evidence stays identified',()=>{
  const parent=id=>({type:'parent',personId:id,kind:'親生'});
  const d=data([p('F'),p('M1','F'),p('M2','F'),p('A','M',[parent('F'),parent('M1')]),p('B','F',[parent('F')])]);
  let graph=Model.build(d);
  assert.equal(Model.siblingEvidence(graph,'A','B').label,'共有父親');
  assert(role(graph,'B','A').contexts.some(x=>x.includes('共有父親')));
  d.people[4].relationships.push(parent('M2')); graph=Model.build(d);
  assert.equal(Model.siblingEvidence(graph,'A','B').label,'同父異母');
  assert(Kinship.query(graph,'A','B').paths[0].notes.includes('同父異母'));
  d.people[4].relationships[0].kind='養子女'; graph=Model.build(d);
  assert.match(Model.siblingEvidence(graph,'A','B').label,/養子女/);
  assert.doesNotMatch(Model.siblingEvidence(graph,'A','B').label,/同父異母/);
});
test('seniority cycles and inverse contradictions report the people involved',()=>{
  const d=data([p('A','M',[relation('sibling','B')]),p('B','M',[relation('sibling','C')]),p('C','M',[relation('sibling','A')])]);
  assert.throws(()=>Model.build(d),error=>error.message.includes('循環')&&error.personIds.includes('A'));
  d.people[1].relationships=[relation('sibling','A')]; d.people[2].relationships=[];
  assert.throws(()=>Model.build(d),/長幼記錄互相矛盾/);
});
test('merge preserves relations and root metadata, rejects self-relations and conflicting ranks',()=>{
  const d={...data([p('A'),p('duplicate','F',[{type:'parent',personId:'P',kind:'親生'}]),p('P')]),familyName:'家',custom:{preserve:true}};
  const next=Model.mergeMembers(d,'A','duplicate',{gender:'F'});
  assert.equal(next.people.length,2); assert.equal(next.people[0].gender,'F');
  assert.equal(Model.relationshipsFor(next,'P')[0].personId,'A'); assert.deepEqual(next.custom,d.custom);
  assert.equal(d.people.length,3);
  assert(Model.dataDifferences(d,next).some(x=>x.includes('移除成員')));
  const direct=data([p('A'),p('B','M',[{type:'sibling',personId:'A'}])]);
  assert.throws(()=>Model.mergeMembers(direct,'A','B'),/自我關係/);
  d.rankGroups=[{id:'g',name:'家',type:'sibling',members:[{personId:'A',order:1},{personId:'duplicate',order:2}]}];
  assert.throws(()=>Model.mergeMembers(d,'A','duplicate'),/排行不同/);
});
test('diff ignores inverse storage relocation, reports actual metadata changes',()=>{
  const d=data([p('A'),p('B','F',[relation('sibling','A')])]);
  const reversed=Model.replaceMember(d,{...d.people[0],relationships:Model.relationshipsFor(d,'A')});
  assert.deepEqual(Model.dataDifferences(d,reversed),[]);
  reversed.people[0].relationships[0].source='訪談';
  assert(Model.dataDifferences(d,reversed).some(x=>x.includes('修改關係')&&x.includes('來源')));
});
test('merging refuses conflicting inverse metadata and preserves extra member fields',()=>{
  const d=data([p('A'),p('B','M',[{type:'parent',personId:'P',kind:'親生',source:'來源一'}]),p('P','M',[{type:'child',personId:'A',kind:'親生',source:'來源二'}])]);
  assert.throws(()=>Model.mergeMembers(d,'A','B'),/双向|雙向/);
  d.people[2].relationships[0].source='來源一'; d.people[1].custom={reference:'保留'};
  assert.deepEqual(Model.mergeMembers(d,'A','B').people[0].custom,{reference:'保留'});
});
test('partial ranks and relative assertions cannot together form a cycle',()=>{
  const d=data([p('A'),p('B','M',[relation('sibling','A','younger')]),p('C','M',[relation('sibling','B','younger')])]);
  d.rankGroups=[{id:'g',type:'sibling',name:'家庭',members:[{personId:'A',order:1},{personId:'B',order:null},{personId:'C',order:3}]}];
  assert.throws(()=>Model.build(d),/矛盾|循環/);
});
