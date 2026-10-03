/* Location rules and a serial, injectable geocoding queue. No UI or persistence dependencies. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FamilyLocation = api;
})(globalThis, function () {
  'use strict';
  const normalize = value => String(value || '').trim().replace(/\s+/g, ' ').replaceAll('臺', '台');
  function privateAddress(value) {
    // Conservative preflight only; mapHidden is the authoritative privacy setting.
    return /私人|住址|住宅|自宅|宿舍房號/.test(value) || /(?:路|街|巷|弄).{0,35}\d+(?:之\d+)?\s*號/.test(value)
      || /^\s*\d+\s+.+\b(?:street|st|road|rd|avenue|ave|lane|ln|drive|dr)\b/i.test(value);
  }
  function eligible(person) { return Boolean(normalize(person.location)) && !person.mapHidden && !privateAddress(person.location); }
  function valid(record) {
    if (!record || record.provider !== 'nominatim' || typeof record.query !== 'string' || !record.query.trim() || record.query.length > 120
      || !['resolved', 'not_found', 'ambiguous'].includes(record.status) || !Number.isFinite(record.checkedAt) || record.checkedAt < 0) return false;
    if (record.status !== 'resolved') return record.lat === undefined && record.lon === undefined;
    return Number.isFinite(record.lat) && Math.abs(record.lat) <= 90 && Number.isFinite(record.lon) && Math.abs(record.lon) <= 180
      && typeof record.displayName === 'string' && record.displayName.length <= 2000
      && ['node','way','relation'].includes(record.osmType) && /^\d+$/.test(String(record.osmId));
  }
  function current(person) { return valid(person.geocode) && normalize(person.geocode.query) === normalize(person.location); }
  function content(data) {
    const result = { ...data, people: data.people.map(p => { const copy = { ...p }; delete copy.geocode; return copy; }) };
    delete result.locationLookupDeviceId;
    return result;
  }
  function resolve(query, results, checkedAt = Date.now()) {
    if (!Array.isArray(results)) throw new Error('所在地服務回傳無效資料。');
    const base = { provider: 'nominatim', query, checkedAt };
    if (!results.length) return { ...base, status: 'not_found' };
    const usable = results.filter(r => r.lat !== '' && r.lon !== '' && r.lat != null && r.lon != null
      && Number.isFinite(Number(r.lat)) && Math.abs(Number(r.lat)) <= 90 && Number.isFinite(Number(r.lon)) && Math.abs(Number(r.lon)) <= 180
      && ['node','way','relation'].includes(r.osm_type) && /^\d+$/.test(String(r.osm_id)) && typeof r.display_name === 'string');
    if (!usable.length) throw new Error('所在地服務未回傳有效座標。');
    const exact = usable.filter(r => normalize(r.name) === normalize(query));
    const selected = usable.length === 1 ? usable[0] : exact.length === 1 ? exact[0] : null;
    if (!selected) return { ...base, status: 'ambiguous' };
    return { ...base, status: 'resolved', lat: Number(selected.lat), lon: Number(selected.lon), displayName: selected.display_name.slice(0, 2000), osmType: selected.osm_type, osmId: String(selected.osm_id) };
  }
  function createQueue({ people, lookup, save, cached = async () => null, cache = async () => {}, available = () => true,
    now = Date.now, schedule = setTimeout, cancel = clearTimeout, status = () => {}, lock = task => task(), backgroundMs = 15000 }) {
    let timer = null, busy = false, stopped = false, nextAt = 0, retry = null;
    const priority = new Set();
    const pending = () => people().filter(p => eligible(p) && !current(p));
    function wake(delay = 0) {
      if (stopped || busy) return;
      if (timer !== null) cancel(timer);
      timer = schedule(() => { timer = null; tick().catch(() => wake(5000)); }, Math.max(delay, nextAt - now(), 0));
    }
    async function tick() {
      if (stopped || busy) return;
      if (!available()) { status('paused'); wake(backgroundMs); return; }
      const jobs = pending();
      if (!jobs.length) { retry = null; status('idle'); return; }
      const person = (retry && jobs.find(p => normalize(p.location) === retry)) || jobs.find(p => priority.has(p.id)) || jobs[0];
      const query = person.location.trim(), key = normalize(query);
      busy = true;
      try {
        const worked = await lock(async () => {
          if (!available() || !pending().some(p => normalize(p.location) === key)) return false;
          const fromPeople = people().find(p => eligible(p) && current(p) && normalize(p.location) === key)?.geocode;
          const hit = fromPeople || await cached(key);
          status('querying', query);
          const result = valid(hit) && normalize(hit.query) === key ? { ...hit, query } : resolve(query, await lookup(query), now());
          await cache(key, result);
          // Persistence rechecks location/privacy against the latest data, inside its transaction.
          await save(query, result);
          for (const p of people()) if (normalize(p.location) === key) priority.delete(p.id);
          retry = null;
          nextAt = now() + backgroundMs;
          status('updated', query);
          return true;
        });
        if (worked === false) nextAt = now() + backgroundMs;
      } catch (error) {
        retry = key;
        nextAt = now() + 5000;
        status('retry', query, error);
      } finally { busy = false; wake(); }
    }
    return { wake, resume() { stopped = false; wake(); }, prioritize(ids) { ids.forEach(id => priority.add(id)); wake(); }, stop() { stopped = true; if (timer !== null) cancel(timer); }, pending };
  }
  return { normalize, privateAddress, eligible, valid, current, content, resolve, createQueue };
});
