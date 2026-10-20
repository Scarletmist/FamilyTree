const test = require('node:test');
const assert = require('node:assert/strict');
const { route, intersects } = require('../src/assets/connector-routing');
const length = points => points.slice(1).reduce((n, p, i) => n + Math.abs(p[0] - points[i][0]) + Math.abs(p[1] - points[i][1]), 0);

test('cross-generation endpoints follow actual generations in either relationship direction', () => {
  const {endpointSides} = require('../src/assets/connector-routing');
  assert.deepEqual(endpointSides({gen:2},{gen:3}),{from:'bottom',to:'top'});
  assert.deepEqual(endpointSides({gen:3},{gen:2}),{from:'top',to:'bottom'});
  assert.deepEqual(endpointSides({gen:2},{gen:2}),{from:'top',to:'top'},'virtual nodes have no facing card edges');
});

test('same-generation neighbors use facing edges while intervening cards keep peers in the upper gutter', () => {
  const {endpointSides} = require('../src/assets/connector-routing');
  const a = {gen:1,x:60,left:0,right:120,top:100,bottom:180};
  const b = {gen:1,x:360,left:300,right:420,top:100,bottom:220};
  assert.deepEqual(endpointSides(a,b,[a,b]),{from:'right',to:'left'});
  assert.deepEqual(endpointSides(b,a,[a,b]),{from:'left',to:'right'});
  const blocker = {left:160,right:260,top:100,bottom:200};
  assert.deepEqual(endpointSides(a,b,[a,blocker,b]),{from:'top',to:'top'});
  assert.deepEqual(endpointSides(a,{...b,left:140},[a]),{from:'top',to:'top'},'a narrow gap cannot fit both escape stubs');
});

test('repositioned child attachments respect ports reserved for other relationship kinds', () => {
  const {attachmentX,segments} = require('../src/assets/connector-routing');
  const x = attachmentX(62,0,140,20,200,segments([[50,0],[50,190]]),[68]);
  assert.equal(x,86);
});

test('routing preserves outward card stubs instead of retracing them to avoid an occupied lane', () => {
  const {segments} = require('../src/assets/connector-routing');
  const cards = [{left:0,right:100,top:-100,bottom:0},{left:200,right:300,top:224,bottom:304}];
  const start = [50,24],end = [250,200],occupied = segments([[20,24],[220,24]]);
  const points = route(start,end,cards,occupied,{startDirection:[0,1],endDirection:[0,-1]});
  assert(points[1][1] >= start[1]);
  assert(points.at(-2)[1] <= end[1]);
  for (let i = 1; i < points.length; i++) assert(cards.every(card => !intersects(points[i-1],points[i],card)));
});
test('attachment moves together with the stem to maintain spacing without an endpoint jog', () => {
  const { attachmentX, segments } = require('../src/assets/connector-routing');
  const occupied = segments([[50, 0], [50, 190]]);
  const x = attachmentX(62, 0, 140, 20, 200, occupied);
  assert.equal(x, 68);
  assert.deepEqual(route([x, 20], [x, 200], [], occupied), [[68, 20], [68, 200]]);
  assert.equal(attachmentX(100, 80, 120, 200, 300, occupied), 100);
});
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
  const { segments, overlapLength } = require('../src/assets/connector-routing');
  assert.equal(segments(points).some(a => occupied.some(b => overlapLength(a, b) > .5)), false);
  assert(points.some(p => p[0] === 82 || p[0] === 118));
});
test('perpendicular crossings are detected away from connector endpoints', () => {
  const { segments, crossings } = require('../src/assets/connector-routing');
  const occupied = segments([[50, 0], [50, 100]]);
  assert.deepEqual(crossings([[0, 40], [100, 40]], occupied, 8), [{ x: 50, y: 40 }]);
  assert.deepEqual(crossings([[42, 40], [100, 40]], occupied, 8), []);
});
test('nearby parallel lines keep an 18px gap even without exact overlap', () => {
  const { segments } = require('../src/assets/connector-routing');
  for (const vertical of [true, false]) {
    const orient = p => vertical ? p : [p[1], p[0]];
    const occupied = segments([orient([100, 40]), orient([100, 160])]);
    const points = route(orient([106, 0]), orient([106, 200]), [], occupied);
    for (const a of segments(points)) for (const b of occupied) {
      if (a.axis === b.axis && Math.min(a.max, b.max) > Math.max(a.min, b.min)) assert(Math.abs(a.fixed - b.fixed) >= 18);
    }
  }
});
test('bridge path replaces a crossing with a rounded SVG arc', () => {
  const { bridgePath } = require('../src/assets/connector-routing');
  const d = bridgePath([[0, 40], [100, 40]], [{ x: 50, y: 40 }], 7);
  assert.match(d, /^M 0 40 L 43 40 A 7 7 0 0 [01] 57 40 L 100 40$/);
});
