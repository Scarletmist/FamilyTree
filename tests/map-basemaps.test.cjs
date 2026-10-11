const test = require('node:test');
const assert = require('node:assert/strict');
const modulePromise = import('../dev/map-runtime/basemaps.mjs');

test('basemap providers preserve XYZ coordinates and distribute satellite tiles without a key', async () => {
  const { BASEMAPS } = await modulePromise;
  assert.equal(BASEMAPS.osm.provider(27393,14052,15),'https://tile.openstreetmap.org/15/27393/14052.png');
  const hosts=new Set();
  for(let x=27393;x<27397;x++){
    const url=new URL(BASEMAPS.satellite.provider(x,14052,15));
    hosts.add(url.hostname);
    assert.equal(url.protocol,'https:');
    assert.equal(url.pathname,`/vt/lyrs=s&x=${x}&y=14052&z=15`);
    assert.equal(url.search,'');assert(!/[{}]|key=|token=/.test(url.href));
  }
  assert.deepEqual([...hosts].sort(),['mt0.google.com','mt1.google.com','mt2.google.com','mt3.google.com']);
});

test('basemap preference notifies both maps and still works when local storage is unavailable', async () => {
  const { getBasemap, selectBasemap, subscribeBasemap } = await modulePromise;
  const original=Object.getOwnPropertyDescriptor(globalThis,'localStorage'), changes=[];
  Object.defineProperty(globalThis,'localStorage',{configurable:true,get(){throw new Error('blocked');}});
  const unsubscribe=subscribeBasemap(()=>changes.push(getBasemap()));
  try {
    selectBasemap('satellite');assert.equal(getBasemap(),'satellite');
    selectBasemap('constructor');selectBasemap('unknown');selectBasemap('satellite');assert.deepEqual(changes,['satellite']);
    unsubscribe();selectBasemap('osm');assert.equal(getBasemap(),'osm');assert.deepEqual(changes,['satellite']);
  } finally {
    unsubscribe();if(original)Object.defineProperty(globalThis,'localStorage',original);else delete globalThis.localStorage;
  }
});
