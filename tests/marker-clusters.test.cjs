const test = require('node:test');
const assert = require('node:assert/strict');
const modulePromise = import('../dev/map-runtime/marker-clusters.mjs');
const group = (key, lat, lon, count = 1) => ({ key, lat, lon, label:key, people:Array.from({ length:count }, (_, i) => ({ name:key + i })) });

test('nearby places cluster at low zoom and count members rather than places', async () => {
  const { clusterGroups } = await modulePromise;
  const groups = [group('temple', 24.7995492, 120.9586319, 2), group('shrine', 24.8028082, 120.9665544)];
  const original = structuredClone(groups);
  const low = clusterGroups(groups, 13);
  assert.equal(low.length, 1);
  assert.equal(low[0].clustered, true);
  assert.equal(low[0].count, 3);
  assert.equal(low[0].groups.length, 2);
  assert(low[0].lat > groups[0].lat && low[0].lat < groups[1].lat);
  assert(low[0].lon > groups[0].lon && low[0].lon < groups[1].lon);
  assert.equal(clusterGroups(groups, 15).length, 2);
  assert.deepEqual(groups, original);
});

test('distant regions stay separate and every member is counted once', async () => {
  const { clusterGroups } = await modulePromise;
  const groups = [group('a', 24.8, 120.96, 3), group('b', 24.8001, 120.9601, 2), group('c', 35.7, 139.7, 4)];
  const clusters = clusterGroups(groups, 8);
  assert.equal(clusters.length, 2);
  assert.equal(clusters.reduce((sum, cluster) => sum + cluster.count, 0), 9);
  assert.deepEqual(clusters.flatMap(cluster => cluster.groups.map(g => g.key)).sort(), ['a', 'b', 'c']);
  assert.equal(clusters.find(cluster => cluster.key === 'c').clustered, false);
  assert.deepEqual(clusterGroups([], 8), []);
});

test('clusters wrap across the date line and remain stable across fractional zoom', async () => {
  const { clusterGroups } = await modulePromise;
  const clusters = clusterGroups([group('west', 0, -179.99), group('east', 0, 179.99, 2)], 8.5);
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].count, 3);
  assert(Math.abs(clusters[0].lon) > 179.9);
});

test('connected neighboring markers form one cluster without duplicate counts', async () => {
  const { clusterGroups } = await modulePromise;
  const groups = [group('a', 0, 0), group('b', 0, 0.08, 2), group('c', 0, 0.16, 3)];
  const clusters = clusterGroups(groups, 10);
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].count, 6);
  assert.equal(clusters[0].groups.length, 3);
});
