const test = require('node:test');
const assert = require('node:assert/strict');
const { connectorGroups } = require('../src/assets/family-model');
const { sharedSegments, segments, overlapLength } = require('../src/assets/connector-routing');
const edge = (from, to, kind) => ({ from, to, kind });
const graph = { bonds: [{ kind: '手足', members: ['B', 'C'] }], descents: [], unions: [], mentorships: [] };
const shared = (g, edges) => new Set(connectorGroups(g, edges).map(s => s.group)).size === 1;
test('teacher branches share only the same teacher, irrespective of sibling status', () => {
  assert(shared(graph, [edge('A', 'B', '師徒'), edge('A', 'C', '師徒')]));
  assert(!shared(graph, [edge('B', 'A', '師徒'), edge('C', 'A', '師徒')]));
  assert(!shared(graph, [edge('A', 'B', '師徒'), edge('B', 'C', '師徒')]));
});
test('tang branches require biological sibling evidence and tolerate reversed edges', () => {
  assert(shared(graph, [edge('A', 'B', '堂親'), edge('C', 'A', '堂親')]));
  assert(!shared({ ...graph, bonds: [] }, [edge('A', 'B', '堂親'), edge('A', 'C', '堂親')]));
  assert(!shared(graph, [edge('A', 'B', '表親'), edge('A', 'C', '表親')]));
  assert(!shared(graph, [edge('A', 'B', '契手足'), edge('A', 'C', '契手足')]));
});
test('siblings and fellow disciples share only a proven common parent or teacher', () => {
  const g = { ...graph, unions: [{ id: 'u', partners: ['P'] }], descents: ['A', 'B', 'C'].map(child => ({ union: 'u', child, kind: '親生' })), mentorships: ['A', 'B', 'C'].map(student => ({ teacher: 'T', student })) };
  assert(shared(g, [edge('A', 'B', '手足'), edge('A', 'C', '手足')]));
  assert(shared(g, [edge('A', 'B', '師兄弟姊妹'), edge('A', 'C', '師兄弟姊妹')]));
  assert(!shared(graph, [edge('A', 'B', '師兄弟姊妹'), edge('A', 'C', '師兄弟姊妹')]));
});

test('elder and younger tang cousins share the sibling cohort from the same root', () => {
  const g = {...graph, bonds:[{kind:'手足',members:['A','B']}]};
  for (const edges of [
    [{...edge('A','C','堂親'),elderId:'A'}, {...edge('B','C','堂親'),elderId:'C'}],
    [{...edge('C','B','堂親'),elderId:'C'}, {...edge('C','A','堂親'),elderId:'A'}]
  ]) {
    const groups = connectorGroups(g,edges);
    assert.equal(groups[0].group,groups[1].group);
    assert(groups.every(group => group.root === 'C'));
  }
});

test('biao branches stay separate even with a proven sibling cohort and common parents', () => {
  const g = {...graph, unions:[{id:'u',partners:['P','Q']}],descents:['B','C'].map(child => ({union:'u',child,kind:'親生'}))};
  assert(!shared(g,[edge('A','B','表親'),edge('C','A','表親')]));
  assert(!shared(g,[edge('A','B','堂親'),edge('A','C','表親')]));
});

test('largest proven star is selected before smaller overlapping stars, independent of record order', () => {
  const g = {...graph,bonds:[['S','T'],['S','U'],['T','U'],['R','X']].map(members => ({kind:'手足',members}))};
  const source = [edge('S','X','堂親'),edge('R','S','堂親'),edge('R','T','堂親'),edge('R','U','堂親')];
  const permutations = items => items.length ? items.flatMap((item,i) => permutations(items.filter((_,j) => i !== j)).map(rest => [item,...rest])) : [[]];
  for (const edges of permutations(source)) {
    const groups = connectorGroups(g,edges.map((e,i) => i % 2 ? {...e,from:e.to,to:e.from} : e));
    const indices = edges.flatMap((e,i) => [e.from,e.to].includes('R') ? [i] : []);
    assert.equal(new Set(indices.map(i => groups[i].group)).size,1);
    assert(indices.every(i => groups[i].root === 'R'));
    assert.equal(groups[edges.findIndex(e => e.from === 'S' && e.to === 'X')].root,undefined);
  }
});

test('one teacher must witness the entire fellow-disciple group, not just every pair', () => {
  const school = {A:['P','Q','R'],B:['P','Q'],C:['Q','R'],D:['P','R']};
  const g = {...graph,mentorships:Object.entries(school).flatMap(([student,teachers]) => teachers.map(teacher => ({student,teacher})))};
  const edges = ['B','C','D'].map(id => edge('A',id,'師兄弟姊妹'));
  const groups = connectorGroups(g,edges);
  assert.equal(new Set(groups.map(s => s.group)).size,2);
  for (const group of new Set(groups.map(s => s.group))) {
    const ids = [...new Set(edges.filter((_,i) => groups[i].group === group).flatMap(e => [e.from,e.to]))];
    assert(school[ids[0]].some(teacher => ids.every(id => school[id].includes(teacher))));
  }
});

test('rank-only or chained sibling evidence does not turn unrelated leaves into one cohort', () => {
  const edges = ['B','C','D'].map(id => edge('A',id,'堂親'));
  const g = {...graph,bonds:[['B','C'],['C','D']].map(members => ({kind:'手足',members}))};
  assert.equal(new Set(connectorGroups(g,edges).map(s => s.group)).size,2);
  assert(!shared({...graph,bonds:[{kind:'手足',members:['B','C'],rankGroupIds:['rank']}]},edges.slice(0,2)));
});

test('overview and detail-only branches never share strokes; inferred branches may join manual ones', () => {
  const a = edge('A','B','堂親'),b = edge('A','C','堂親');
  assert(!shared(graph,[a,{...b,detailsOnly:true}]));
  assert(shared(graph,[{...a,detailsOnly:true},{...b,detailsOnly:true}]));
  assert(shared(graph,[a,{...b,inferred:true}]));
});

test('two biological sibling cohorts share all cross-cousin edges, not separate root stars', () => {
  const g = {...graph,bonds:[['A','B'],['C','D']].map(members => ({kind:'手足',members}))};
  const edges = ['A','B'].flatMap(a => ['C','D'].map(b => edge(a,b,'堂親')));
  for (let offset=0;offset<edges.length;offset++) {
    const reordered = [...edges.slice(offset),...edges.slice(0,offset)].map((e,i) => i%2 ? {...e,from:e.to,to:e.from} : e);
    const groups = connectorGroups(g,reordered);
    assert.equal(new Set(groups.map(g => g.group)).size,1);
    assert(groups.every(g => g.shared && !g.root));
  }
});

test('incomplete cousin cross links and unrelated sibling cohorts remain separate', () => {
  const g = {...graph,bonds:[['A','B'],['C','D']].map(members => ({kind:'手足',members}))};
  const edges = [edge('A','C','堂親'),edge('A','D','堂親'),edge('B','C','堂親')];
  assert.equal(new Set(connectorGroups(g,edges).map(g => g.group)).size,2,'does not invent B–D');
  assert(!shared({...g,bonds:[]},edges));
});

test('all pairwise links in one school share one cohort when they have the same teacher', () => {
  const ids = ['A','B','C','D','E'];
  const g = {...graph,mentorships:ids.map(student => ({student,teacher:'T'}))};
  const edges = ids.flatMap((from,i) => ids.slice(i+1).map(to => edge(from,to,'師兄弟姊妹')));
  assert.equal(edges.length,10);
  assert(shared(g,edges));
  assert(connectorGroups(g,edges).every(g => g.shared && !g.root));
});

test('rank cohorts share display strokes without inventing parents or teachers', () => {
  for (const [type,kind] of [['sibling','手足'],['swornSibling','契手足'],['fellowDisciple','師兄弟姊妹']]) {
    const ids = ['A','B','C','D','E'];
    const g = {...graph,bonds:[],rankGroups:[{id:'r',type,members:ids.map(personId => ({personId}))}]};
    const edges = ids.flatMap((from,i) => ids.slice(i+1).map(to => ({...edge(from,to,kind),detailsOnly:true,rankGroupIds:['r']})));
    assert(shared(g,edges),type);
    assert(shared({...g,rankGroups:[]},edges),type+' projected edges retain source IDs');
    assert(!shared({...g,rankGroups:[]},edges.map(({rankGroupIds,...e}) => e)),type+' needs an explicit source');
    assert.deepEqual(g.descents,[]);
    assert.deepEqual(g.mentorships,[]);
  }
});

test('overlapping rank cohorts do not merge merely because a member or name is shared', () => {
  const sources = [['A','B','C'],['C','D','E']];
  const g = {...graph,bonds:[],rankGroups:sources.map((members,i) => ({id:'r'+i,name:'同名師門',type:'fellowDisciple',members:members.map(personId => ({personId}))}))};
  const edges = sources.flatMap(ids => ids.flatMap((from,i) => ids.slice(i+1).map(to => ({...edge(from,to,'師兄弟姊妹'),detailsOnly:true}))));
  const groups = connectorGroups(g,edges);
  assert.equal(new Set(groups.map(g => g.group)).size,2);
  assert.notEqual(groups[1].group,groups[3].group);
});
test('overlapping intervals render once and preserve branch-specific highlighting', () => {
  const result = sharedSegments([{ points: [[0, 0], [0, 20], [30, 20]], people: ['A', 'B'] }, { points: [[0, 0], [0, 20], [60, 20]], people: ['A', 'C'] }]);
  const lines = result.flatMap(p => segments(p.points));
  assert(lines.every((a, i) => lines.slice(i + 1).every(b => overlapLength(a, b) === 0)));
  assert.deepEqual(result.find(p => p.points[0][0] === 30).people, ['A', 'C']);
  assert.deepEqual(result[0].people, ['A', 'B', 'C']);
});

test('hiding inferred branches preserves manual portions of a shared stroke', () => {
  const result = sharedSegments([
    { points: [[0, 0], [0, 20], [30, 20]], people: ['A', 'B'], inferred: false },
    { points: [[0, 0], [0, 20], [60, 20]], people: ['A', 'C'], inferred: true }
  ]);
  const manual = result.filter(segment => !segment.inferred);
  assert.deepEqual(manual.map(segment => segment.points), [[[0, 0], [0, 20]], [[0, 20], [30, 20]]]);
  assert.deepEqual(result.filter(segment => segment.inferred).map(segment => segment.points), [[[30, 20], [60, 20]]]);
  assert(sharedSegments([{ points: [[0, 0], [10, 0]], people: ['A', 'C'], inferred: true }]).every(segment => segment.inferred));
});
