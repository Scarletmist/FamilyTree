/* Browser coordinator: shared cache, one device owner, one origin-wide query lock. */
(function () {
  'use strict';
  const Location = window.FamilyLocation;
  const key = 'family-tree:location-settings:' + new URL('./', location.href).pathname;
  let storedDeviceId;
  try { storedDeviceId = JSON.parse(localStorage.getItem(key) || '{}')?.deviceId; } catch {}
  const deviceId = typeof storedDeviceId === 'string' && storedDeviceId ? storedDeviceId : crypto.randomUUID();
  const endpoint = 'https://nominatim.openstreetmap.org/search';
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
  async function lookup(query) {
    const url = new URL(endpoint);
    url.searchParams.set('q', query);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('addressdetails', '1');
    url.searchParams.set('limit', '5');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(url, { signal: controller.signal, credentials: 'omit', referrerPolicy: 'strict-origin-when-cross-origin' });
      if (!response.ok) throw new Error(`定位服務暫時無法使用（${response.status}）。`);
      return await response.json();
    } finally { clearTimeout(timer); }
  }
  const queue = Location.createQueue({
    people: () => data()?.people || [],
    lookup,
    save: (query, result) => FamilyApp.locationCommand({ type: 'updateLocations', query, result }),
    cached: key => FamilyRepository.getLocationCache(key),
    cache: (key, result) => FamilyRepository.setLocationCache(key, result),
    available: () => isOwner() && navigator.onLine && document.visibilityState === 'visible'
      && !document.querySelector('#member-dialog[open], #family-name-dialog[open], #import-dialog[open], .family-management-dialog[open]'),
    status: notify,
    lock: async task => {
      // Web Locks coordinates different tabs and families on the same origin.
      // Browsers without Web Locks keep data/map usable, and do not start parallel background traffic.
      if (!navigator.locks) { notify('unsupported'); return false; }
      return navigator.locks.request('family-tree:nominatim', { ifAvailable: true }, async lease => {
        if (!lease) return false;
        const rateKey = 'family-tree:nominatim-next-request';
        let next = 0;
        try { next = Number(localStorage.getItem(rateKey) || 0); } catch {}
        if (Date.now() < next) return false;
        // All successful/background queries are spaced 15 seconds; an error retries after 5 seconds.
        try { localStorage.setItem(rateKey, String(Date.now() + 15000)); } catch {}
        try { return await task(); }
        catch (error) { try { localStorage.setItem(rateKey, String(Date.now() + 5000)); } catch {} throw error; }
      });
    }
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
  // Closing a form resumes the background queue without changing unsaved form values.
  document.querySelectorAll('#member-dialog, #family-name-dialog, #import-dialog').forEach(dialog => dialog.addEventListener('close', () => queue.wake()));
  window.FamilyMemberLocations = {
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
