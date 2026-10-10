/* Browser coordinator: shared cache, one device owner, one origin-wide query lock. */
(function () {
  'use strict';
  const Location = window.FamilyLocation;
  const key = 'family-tree:location-settings:' + new URL('./', location.href).pathname;
  let storedDeviceId;
  try { storedDeviceId = JSON.parse(localStorage.getItem(key) || '{}')?.deviceId; } catch {}
  const deviceId = typeof storedDeviceId === 'string' && storedDeviceId ? storedDeviceId : crypto.randomUUID();
  const endpointConfigUrl = new URL('../data/location-config.json', document.currentScript.src);
  // Preserve the device owner while discarding legacy user-configurable options.
  try { localStorage.setItem(key, JSON.stringify({ deviceId })); } catch {}
  let previous = null, claiming = false;
  const data = () => FamilyApp.snapshot()?.data;
  const isOwner = () => data()?.locationLookupDeviceId === deviceId;
  let state = { kind: 'idle', query: '' };
  function notify(kind = state.kind, query = state.query, error = null) {
    state = { kind, query, error: error?.message || '', pending: queue.pending().length, owner: isOwner() };
    window.dispatchEvent(new CustomEvent('familylocationstatus', { detail: state }));
  }
  async function ensureOwner() {
    if (claiming || !data() || data().locationLookupDeviceId || !queue.pending().length) return;
    claiming = true;
    try { await FamilyApp.locationCommand({ type: 'claimLocationLookup', deviceId: deviceId }); }
    catch (error) { notify('retry', '', error); }
    finally { claiming = false; queue.wake(); }
  }
  async function lookup(query, signal) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      // Deployment configuration is managed by the site operator, without a user settings UI.
      const configResponse = await fetch(endpointConfigUrl, { signal: controller.signal, cache: 'no-store' });
      if (!configResponse.ok) throw new Error('無法讀取定位服務設定。');
      const url = new URL((await configResponse.json()).nominatimSearchUrl);
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('定位服務設定須為 HTTPS 查詢端點。');
      url.searchParams.set('q', query);
      url.searchParams.set('format', 'jsonv2');
      url.searchParams.set('addressdetails', '1');
      url.searchParams.set('limit', '5');
      const response = await fetch(url, { signal: controller.signal, credentials: 'omit', referrerPolicy: 'strict-origin-when-cross-origin' });
      if (!response.ok) throw new Error(`定位服務暫時無法使用（${response.status}）。`);
      const results = await response.json();
      const items = Location.candidates(query, results);
      await FamilyRepository.setLocationCache('candidates:' + Location.normalize(query), { query, items });
      return results;
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  }
  async function withQueryLock(task) {
    // Background and user searches share a single origin-wide lease and 15-second interval.
    // A failed request permits a retry five seconds after the failure.
    if (!navigator.locks) { notify('unsupported'); return false; }
    return navigator.locks.request('family-tree:nominatim', { ifAvailable: true }, async lease => {
      if (!lease) return false;
      const rateKey = 'family-tree:nominatim-next-request';
      let next = 0;
      try { next = Number(localStorage.getItem(rateKey) || 0); } catch {}
      if (Date.now() < next) return false;
      try { localStorage.setItem(rateKey, String(Date.now() + 15000)); } catch {}
      try { return await task(); }
      catch (error) { try { localStorage.setItem(rateKey, String(Date.now() + 5000)); } catch {} throw error; }
    });
  }
  function wait(ms, signal) {
    return new Promise((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(new DOMException('查詢已取消', 'AbortError')); };
      const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
    });
  }
  async function search(query, { signal, status = () => {} } = {}) {
    query = query.trim();
    if (!query || query.length > 120 || Location.privateAddress(query)) throw new Error('請填寫公開地名，不要輸入私人住址。');
    const hit = await FamilyRepository.getLocationCache('candidates:' + Location.normalize(query));
    if (hit && Location.normalize(hit.query) === Location.normalize(query) && Array.isArray(hit.items)
      && hit.items.every(item => Location.valid(item) && item.status === 'resolved' && Location.normalize(item.query) === Location.normalize(query))) return hit.items;
    if (!navigator.locks) throw new Error('此瀏覽器不支援地點查詢，仍可在地圖上指定位置。');
    for (;;) {
      if (signal?.aborted) throw new DOMException('查詢已取消', 'AbortError');
      if (!navigator.onLine || document.visibilityState !== 'visible') { status('等待網路或頁面恢復…'); await wait(1000, signal); continue; }
      try {
        let items;
        const worked = await withQueryLock(async () => {
          if (signal?.aborted) throw new DOMException('查詢已取消', 'AbortError');
          status('正在查詢地點…');
          items = Location.candidates(query, await lookup(query, signal));
          return true;
        });
        if (worked) return items;
        status('等待查詢間隔…');
        let next = 0;
        try { next = Number(localStorage.getItem('family-tree:nominatim-next-request') || 0); } catch {}
        await wait(Math.max(500, next - Date.now()), signal);
      } catch (error) {
        if (signal?.aborted) throw new DOMException('查詢已取消', 'AbortError');
        status('查詢失敗，5 秒後重試；也可以在地圖上指定位置。');
        await wait(5000, signal);
      }
    }
  }
  const queue = Location.createQueue({
    people: () => data()?.people || [],
    lookup,
    save: (query, result) => FamilyApp.locationCommand({ type: 'updateLocations', query, result }),
    cached: key => FamilyRepository.getLocationCache(key),
    cache: (key, result) => FamilyRepository.setLocationCache(key, result),
    available: () => !FamilyRepository.isResetting?.() && isOwner() && navigator.onLine && document.visibilityState === 'visible'
      && !document.querySelector('#member-dialog[open], #family-name-dialog[open], #import-dialog[open], .family-management-dialog[open], #member-map-dialog[open][data-editing="true"]'),
    status: notify,
    lock: withQueryLock
  });
  function changed(event) {
    const next = event.detail?.snapshot?.data;
    if (!next) return;
    const old = new Map((previous?.people || []).map(p => [p.id, p]));
    const priority = next.people.filter(p => {
      const before = old.get(p.id);
      return Location.eligible(p) && (!before || Location.normalize(before.location) !== Location.normalize(p.location) || before.mapHidden !== p.mapHidden);
    }).map(p => p.id);
    previous = next;
    ensureOwner();
    if (priority.length && ['local', 'ui'].includes(event.detail.source)) queue.prioritize(priority);
    else queue.wake();
    notify();
  }
  window.addEventListener('familyappchange', changed);
  window.addEventListener('online', () => { ensureOwner(); queue.wake(); });
  document.addEventListener('visibilitychange', () => { ensureOwner(); queue.wake(); });
  window.addEventListener('pagehide', () => queue.stop());
  window.addEventListener('pageshow', event => { if (event.persisted) queue.resume(); });
  window.addEventListener('familylocationcorrectionclose', () => { ensureOwner(); queue.wake(); });
  // Closing a form resumes the background queue without changing unsaved form values.
  document.querySelectorAll('#member-dialog, #family-name-dialog, #import-dialog').forEach(dialog => dialog.addEventListener('close', () => queue.wake()));
  window.FamilyMemberLocations = {
    search,
    state: () => ({ ...state, owner: isOwner(), pending: queue.pending().length }),
    async takeOver() { await FamilyApp.locationCommand({ type: 'claimLocationLookup', deviceId: deviceId, takeOver: true }); queue.wake(); notify(); },
    async retry(id) {
      const person = data()?.people.find(p => p.id === id);
      if (!person || !Location.eligible(person)) return;
      await FamilyRepository.clearLocationCache(Location.normalize(person.location));
      await FamilyApp.locationCommand({ type: 'resetLocation', id });
      queue.prioritize([id]);
    }
  };
  if (data()) changed({ detail: { snapshot: FamilyApp.snapshot(), source: 'load' } });
})();
