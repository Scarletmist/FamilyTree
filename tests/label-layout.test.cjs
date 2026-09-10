const test = require('node:test');
const assert = require('node:assert/strict');
const { place, overlaps } = require('../assets/label-layout');
const bounds = { left: 80, right: 500, top: 12, bottom: 400 };
test('coincident labels separate and avoid cards, retaining all labels', () => {
  const labels = Array.from({ length: 15 }, () => ({ x: 200, y: 110, width: 90, height: 22 }));
  const obstacles = [{ x: 200, y: 140, width: 176, height: 124 }];
  const result = place(labels, obstacles, bounds);
  assert.equal(result.length, labels.length);
  result.forEach((r, i) => {
    assert(!obstacles.some(o => overlaps(r, o)));
    assert(!result.slice(0, i).some(o => overlaps(r, o)));
    assert(r.x >= bounds.left && r.x + r.width <= bounds.right);
  });
});
test('unobstructed labels keep their preferred anchors deterministically', () => {
  const labels = [{ x: 180, y: 120, width: 36, height: 22 }];
  assert.deepEqual(place(labels, [], bounds), labels);
});
test('when crowded space is exhausted labels use extra space below instead of overlapping', () => {
  const obstacle = { x: 80, y: 0, width: 420, height: 450 };
  const labels = [{ x: 200, y: 50, width: 90, height: 22 }, { x: 200, y: 50, width: 90, height: 22 }];
  const result = place(labels, [obstacle], bounds);
  assert(result[0].y > obstacle.y + obstacle.height);
  assert(!overlaps(result[0], result[1]));
});
