const test = require('node:test');
const assert = require('node:assert/strict');
const Model = require('../src/assets/family-model');
const Details = require('../src/assets/relationship-details');
const Evidence = require('../src/assets/relationship-evidence');
const Inference = require('../src/assets/family-inference');
const Commands = require('../src/assets/family-commands');
const Kinship = require('../src/assets/kinship').create(require('../src/data/kinship-terms.json'));
const p = (id, relationships = [], gender = 'M', siblingOrder = null) => ({ id, name:id, relationships, gender, siblingOrder, location:'', position:'' });
const r = (type, personId, seniority) => ({ type, personId, ...(seniority ? { seniority } : {}) });
const data = people => ({ schemaVersion:3, people });
const auto = (graph, from, to, type) => graph.inferredRelations.find(relation => relation.from === from && relation.personId === to && relation.type === type);
const role = (graph, base, target, category = 'cousins') => Details.buildGroups(graph,base).find(group => group.id === category).entries.find(entry => entry.personId === target);

for (const [type,prefix] of [['tangCousin','堂'],['biaoCousin','表']]) {
  for (const [gender,noun] of [['M','弟'],['F','妹'],['U','年幼手足']]) {
    test(`${type} ${gender}: C > A > B determines B/C, while A > D and A > B leave B/D unknown`, () => {
      const source = data([p('A',[r('sibling','B','younger'),r(type,'C','older'),r(type,'D','younger')]),
        p('B',[],gender),p('C'),p('D')]);
      const original = structuredClone(source);
      for (const people of [source.people, source.people.slice().reverse()]) {
        const completed = Model.completeKinship({ ...source,people }), graph = Model.build(completed);
        assert.equal(auto(graph,'C','B',type).seniority,'younger');
        assert.equal(auto(graph,'B','C',type).seniority,'older');
        assert.equal(auto(graph,'B','D',type).seniority,undefined);
        assert.equal(role(graph,'C','B').role,prefix + noun);
        assert.equal(role(graph,'D','B').role,prefix + ({ M:'兄弟',F:'姊妹',U:'兄弟姊妹' })[gender]);
        assert.equal(Kinship.query(graph,'B','C').paths[0].title,prefix + noun);
        assert(!role(graph,'C','B').missing.includes('長幼未確認'));
        assert(role(graph,'D','B').missing.includes('長幼未確認'));
        assert(!Kinship.query(graph,'B','C').paths[0].notes.some(note => note.includes('不推定兩人的長幼')));
        assert.equal(Model.completeKinship(completed),completed);
      }
      assert.deepEqual(source,original);
    });
  }
}

for (const [type,category,expected] of [['sibling','siblings','妹'],['swornSibling','siblings','契妹']]) {
  test(`${type}: indirect order also refines an existing peer relationship with unknown seniority`, () => {
    const source = data([p('A',[r(type,'B','younger'),r(type,'C','older')]),p('B',[r(type,'C')],'F'),p('C')]);
    const graph = Model.build(source);
    assert.equal(role(graph,'C','B',category).role,expected);
    assert.equal(Kinship.query(graph,'B','C').paths[0].title,expected);
    assert.equal(source.people[1].relationships[0].seniority,undefined);
  });
}

test('age comparisons do not invent a kinship type between unrelated cousins', () => {
  const source = data([p('A',[r('tangCousin','B','older')]),p('B',[r('biaoCousin','C','older')]),p('C')]);
  const graph = Model.build(source);
  assert.equal(auto(graph,'A','C','tangCousin'),undefined);
  assert.equal(auto(graph,'A','C','biaoCousin'),undefined);
  assert.equal(Model.peerPresentation(graph,graph.people[2],graph.people[0],'biaoCousin').order,-1);
});

test('family ranks are compared only within established sibling families', () => {
  const source = data([p('P'),p('Q'),p('A',[{ type:'parent',personId:'P',kind:'親生' },r('tangCousin','C','older')],'M',2),
    p('B',[{ type:'parent',personId:'P',kind:'親生' }],'M',3),
    p('C',[{ type:'parent',personId:'Q',kind:'親生' }],'M',8)]);
  const graph = Model.build(source);
  assert.equal(auto(graph,'C','B','tangCousin').seniority,'younger');
  source.people[2].relationships = source.people[2].relationships.filter(relation => relation.type !== 'tangCousin');
  source.people[3].relationships.push(r('tangCousin','C'));
  assert.equal(Model.peerPresentation(Model.build(source),source.people[4],source.people[3],'tangCousin').order,0);
});

test('school order stays within its selected rank group and does not establish biological age', () => {
  const source = data([p('A',[{ ...r('fellowDisciple','B','younger'),groupId:'one' }]),p('B',[],'F'),p('C')]);
  source.rankGroups = [{ id:'one',name:'甲門',type:'fellowDisciple',members:[{personId:'A',order:2},{personId:'B',order:3},{personId:'C',order:1}] },
    { id:'two',name:'乙門',type:'fellowDisciple',members:[{personId:'A',order:1},{personId:'B',order:null},{personId:'C',order:2}] }];
  const graph = Model.build(source), [a,b,c] = graph.people;
  assert.equal(Model.peerPresentation(graph,b,c,'fellowDisciple',{groupId:'one'}).order,1);
  assert.equal(Inference.createSeniorityResolver(source).compare('C','B','fellowDisciple','one').path.length,2);
  assert.equal(Model.peerPresentation(graph,b,c,'fellowDisciple',{groupId:'two'}).order,0);
  assert.equal(Model.peerPresentation(graph,b,c,'fellowDisciple').order,0);
  assert.equal(Model.peerPresentation(graph,b,c,'sibling').order,0);
});

test('indirect sibling order distinguishes paternal uncles without comparing children to their uncles', () => {
  const source = data([p('P',[r('sibling','A','older'),r('sibling','R')]),p('A',[r('sibling','R','older')]),p('R'),
    p('C',[{type:'parent',personId:'P',kind:'親生'}])]);
  const graph = Model.build(source);
  assert.equal(auto(graph,'C','R','uncleAunt').seniority,'older');
  assert.equal(role(graph,'C','R','unclesAunts').role,'伯父');
  assert.equal(auto(graph,'R','C','nephewNiece').seniority,undefined);
});

test('removing a seniority premise retracts the age while preserving the inferred cousin relationship', () => {
  const source = Model.completeKinship(data([p('A',[r('sibling','B','younger'),r('tangCousin','C','older')]),p('B'),p('C')]));
  const member = source.people[0];
  const change = Commands.apply(source,{ type:'updateMember',id:'A',member:{...member,relationships:[r('sibling','B','younger'),r('tangCousin','C')]} });
  const graph = Model.build(change.data);
  assert.equal(auto(graph,'C','B','tangCousin').seniority,undefined);
  assert.equal(role(graph,'C','B').role,'堂兄弟');
  assert.equal(role(graph,'C','B').missing.includes('長幼未確認'),true);
});

test('seniority evidence includes source comparisons outside the kinship path', () => {
  const source = data([p('A',[r('sibling','B'),r('tangCousin','C')]),
    p('B',[r('biaoCousin','X','older')]),p('X',[r('tangCousin','C','older')]),p('C')]);
  const graph = Model.build(Model.completeKinship(source)), relation = auto(graph,'C','B','tangCousin');
  assert.equal(relation.seniority,'younger');
  const proof = Evidence.create(graph).describe('C',relation);
  assert(proof.premises.some(step => step.from === 'X' || step.to === 'X'));
  assert(proof.premises.every(step => step.records.length));
  const query = Kinship.query(graph,'B','C').paths[0];
  assert.equal(query.title,'堂弟');
  assert(query.seniorityPath.some(step => step.from === 'X' || step.to === 'X'));
});

test('cyclic orders do not infer ages and do not block a separate consistent component', () => {
  const source = data([p('A',[r('tangCousin','B','older'),r('sibling','X','younger')]),
    p('B',[r('biaoCousin','C','older')]),p('C',[r('tangCousin','A','older')]),p('X'),
    p('D',[r('sibling','E','younger'),r('tangCousin','F','older')]),p('E'),p('F')]);
  const graph = Model.build(source);
  assert.equal(auto(graph,'X','B','tangCousin').seniority,undefined);
  assert.equal(auto(graph,'F','E','tangCousin').seniority,'younger');
});

test('parents seniority cannot establish the ages of their respective children', () => {
  const source = data([p('P',[r('sibling','Q','younger')]),p('Q'),
    p('A',[{type:'parent',personId:'P',kind:'親生'}]),p('B',[{type:'parent',personId:'Q',kind:'親生'}])]);
  const graph = Model.build(source);
  assert.equal(auto(graph,'A','B','tangCousin').seniority,undefined);
  assert.equal(role(graph,'A','B').role,'堂兄弟');
});

test('declared sibling chains derive siblings as well as their provable seniority', () => {
  for (const gender of ['M','F']) {
    const source = data([p('A',[r('sibling','B','younger'),r('sibling','C','older'),r('sibling','D','younger')]),
      p('B',[],gender),p('C'),p('D')]);
    const completed = Model.completeKinship(source), graph = Model.build(completed);
    assert.equal(auto(graph,'C','B','sibling').seniority,'younger');
    assert.equal(role(graph,'C','B','siblings').role,gender === 'M' ? '弟' : '妹');
    assert.equal(Kinship.query(graph,'B','C').paths[0].title,gender === 'M' ? '弟' : '妹');
    assert.equal(auto(graph,'D','B','sibling').seniority,undefined);
    assert(role(graph,'D','B','siblings').missing.includes('長幼未確認'));
    assert(graph.bonds.some(bond => bond.kind === '手足' && bond.inferred && bond.members.includes('B') && bond.members.includes('C')));
    assert.equal(completed.people.find(person => person.id === 'B').relationships.length,0);
    assert.equal(Model.completeKinship(completed),completed);
  }
});

test('known conflicting parents and independent social circles cannot bridge sibling membership', () => {
  const source = data([p('A',[r('sibling','B'),r('sibling','C')]),
    p('B',[{type:'parent',personId:'P',kind:'親生'}]),p('C',[{type:'parent',personId:'Q',kind:'親生'}]),p('P'),p('Q')]);
  assert.equal(auto(Model.build(source),'B','C','sibling'),undefined);
  for (const type of ['swornSibling','fellowDisciple']) {
    const graph = Model.build(data([p('A',[r(type,'B'),r(type,'C')]),p('B'),p('C')]));
    assert.equal(auto(graph,'B','C',type),undefined);
    assert(!graph.bonds.some(bond => bond.members.includes('B') && bond.members.includes('C')));
  }
});
