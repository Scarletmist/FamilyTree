const test = require('node:test');
const assert = require('node:assert/strict');
const { route, intersects } = require('../assets/connector-routing');
const length = points => points.slice(1).reduce((n, p, i) => n + Math.abs(p[0] - points[i][0]) + Math.abs(p[1] - points[i][1]), 0);
test('vertical route passes through an interior card gap without exterior detour', () => {
  const cards = [{ left: 0, right: 80, top: 60, bottom: 160 }, { left: 120, right: 200, top: 60, bottom: 160 }];
  const points = route([100, 20], [100, 200], cards);
  assert.deepEqual(points, [[100, 20], [100, 200]]);
});
test('a blocking card is bypassed at its nearby edge with clearance', () => {
  const cards = [{ left: 180, right: 240, top: 60, bottom: 160 }];
  const points = route([210, 20], [210, 200], cards);
  assert(length(points) < 300);
  assert(points.some(p => p[0] === 172 || p[0] === 248));
  for (let i = 1; i < points.length; i++) assert(cards.every(card => !intersects(points[i - 1], points[i], card)));
});
test('aligned row gutters take the direct horizontal path', () => {
  assert.deepEqual(route([20, 30], [300, 30], [{ left: 80, right: 200, top: 50, bottom: 150 }]), [[20, 30], [300, 30]]);
});
test('an occupied connector lane is bypassed instead of overlapped', () => {
  const occupied = [{ axis: 'v', fixed: 100, min: 20, max: 200, x1: 100, y1: 20, x2: 100, y2: 200 }];
  const points = route([100, 20], [100, 200], [], occupied);
  const { segments, overlapLength } = require('../assets/connector-routing');
  assert.equal(segments(points).some(a => occupied.some(b => overlapLength(a, b) > .5)), false);
  assert(points.some(p => p[0] === 88 || p[0] === 112));
});
test('perpendicular crossings are detected away from connector endpoints', () => {
  const { segments, crossings } = require('../assets/connector-routing');
  const occupied = segments([[50, 0], [50, 100]]);
  assert.deepEqual(crossings([[0, 40], [100, 40]], occupied, 8), [{ x: 50, y: 40 }]);
  assert.deepEqual(crossings([[42, 40], [100, 40]], occupied, 8), []);
});
test('bridge path replaces a crossing with a rounded SVG arc', () => {
  const { bridgePath } = require('../assets/connector-routing');
  const d = bridgePath([[0, 40], [100, 40]], [{ x: 50, y: 40 }], 7);
  assert.match(d, /^M 0 40 L 43 40 A 7 7 0 0 [01] 57 40 L 100 40$/);
});
