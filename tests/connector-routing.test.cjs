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
