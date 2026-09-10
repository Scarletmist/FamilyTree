const test = require('node:test');
const assert = require('node:assert/strict');
const { connectorGroups } = require('../assets/family-model');
const { sharedSegments, segments, overlapLength } = require('../assets/connector-routing');
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
test('overlapping intervals render once and preserve branch-specific highlighting', () => {
  const result = sharedSegments([{ points: [[0, 0], [0, 20], [30, 20]], people: ['A', 'B'] }, { points: [[0, 0], [0, 20], [60, 20]], people: ['A', 'C'] }]);
  const lines = result.flatMap(p => segments(p.points));
  assert(lines.every((a, i) => lines.slice(i + 1).every(b => overlapLength(a, b) === 0)));
  assert.deepEqual(result.find(p => p.points[0][0] === 30).people, ['A', 'C']);
  assert.deepEqual(result[0].people, ['A', 'B', 'C']);
});
