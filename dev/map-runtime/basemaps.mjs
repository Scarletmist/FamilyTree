export const BASEMAPS = {
  osm: {
    label:'OpenStreetMap 街道圖',
    provider:(x, y, z) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`
  },
  satellite: {
    label:'Google 衛星圖',
    provider:(x, y, z) => `https://mt${((x + y) % 4 + 4) % 4}.google.com/vt/lyrs=s&x=${x}&y=${y}&z=${z}`
  }
};

const preferenceKey = 'family-tree:map-basemap';
let preference = 'osm';
try { if (globalThis.localStorage?.getItem(preferenceKey) === 'satellite') preference = 'satellite'; } catch {}
const listeners = new Set();
export const getBasemap = () => preference;
export function subscribeBasemap(listener) { listeners.add(listener); return () => listeners.delete(listener); }
export function selectBasemap(id) {
  if (!Object.hasOwn(BASEMAPS, id) || id === preference) return;
  preference = id;
  // This is a local view preference, not family data or an undoable edit.
  try { globalThis.localStorage?.setItem(preferenceKey, id); } catch {}
  listeners.forEach(listener => listener());
}
