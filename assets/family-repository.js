/* One persistence boundary: development API or IndexedDB-backed static deployment. */
(function () {
  'use strict';
  const isStatic = document.querySelector('meta[name="family-storage-mode"]')?.content === 'browser';
  let storagePath = '/';
  try {
    if (location.protocol === 'http:' || location.protocol === 'https:') storagePath = new URL('./', location.href).pathname;
  } catch {}
  const legacyKey = 'family-static-v1:' + storagePath;
  const dbName = 'family-tree-v2:' + storagePath;
  const storeName = 'records';
  const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const defaultData = () => ({ schemaVersion: 2, familyName: '我的家族', people: [] });
  let dbPromise = null;

  function assertPayload(payload) {
    if (!payload || typeof payload !== 'object' || typeof payload.version !== 'string') throw new Error('瀏覽器族譜資料格式不正確。');
    FamilyModel.build(payload.data);
    return payload;
  }
  function openDb() {
    if (!isStatic) return Promise.reject(new Error('開發模式不使用 IndexedDB 儲存族譜。'));
    if (!('indexedDB' in window)) return Promise.reject(new Error('此瀏覽器不支援 IndexedDB。'));
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(dbName, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(storeName)) db.createObjectStore(storeName, { keyPath: 'key' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('無法開啟 IndexedDB。'));
      request.onblocked = () => reject(new Error('IndexedDB 更新被其他分頁阻擋，請關閉其他族譜分頁後重試。'));
    }).catch(error => { dbPromise = null; throw error; });
    return dbPromise;
  }
  async function recordGet(key) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const request = tx.objectStore(storeName).get(key);
      request.onsuccess = () => resolve(request.result?.value ?? null);
      request.onerror = () => reject(request.error || new Error('無法讀取 IndexedDB。'));
    });
  }
  async function recordPut(key, value) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).put({ key, value });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('無法寫入 IndexedDB。'));
      tx.onabort = () => reject(tx.error || new Error('IndexedDB 寫入已取消。'));
    });
  }
  async function recordPutMany(entries) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      entries.forEach(([key, value]) => store.put({ key, value }));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('無法寫入 IndexedDB。'));
      tx.onabort = () => reject(tx.error || new Error('IndexedDB 寫入已取消。'));
    });
  }
  async function migrateLegacy() {
    const existing = await recordGet('current');
    if (existing) return assertPayload(existing);
    let legacy = null;
    try {
      const text = localStorage.getItem(legacyKey);
      if (text) legacy = assertPayload(JSON.parse(text));
    } catch {}
    if (legacy) {
      const entries = [
        ['current', { ...legacy, savedAt: Date.now() }],
        ['sync', { fileId: null, remoteVersion: null, dirty: true, connected: false, lastSyncedAt: null }]
      ];
      try {
        const backupText = localStorage.getItem(legacyKey + ':before-import');
        if (backupText) {
          const backup = assertPayload(JSON.parse(backupText));
          entries.push(['before-import', { ...backup, savedAt: Date.now() }]);
        }
      } catch {}
      await recordPutMany(entries);
      try {
        localStorage.removeItem(legacyKey);
        localStorage.removeItem(legacyKey + ':before-import');
      } catch {}
      return legacy;
    }
    return null;
  }
  async function read() {
    const migrated = await migrateLegacy();
    if (migrated) return migrated;
    const saved = await recordGet('current');
    if (!saved) return { data: defaultData(), version: 'empty' };
    return assertPayload(saved);
  }
  async function getSyncState() {
    if (!isStatic) return { fileId: null, remoteVersion: null, dirty: false, connected: false, lastSyncedAt: null };
    const state = await recordGet('sync');
    return {
      fileId: null,
      remoteVersion: null,
      dirty: false,
      connected: false,
      lastSyncedAt: null,
      ...(state || {})
    };
  }
  async function setSyncState(patch) {
    if (!isStatic) return getSyncState();
    const state = { ...(await getSyncState()), ...patch };
    await recordPut('sync', state);
    window.dispatchEvent(new CustomEvent('familyreposyncstate', { detail: state }));
    return state;
  }
  function emitChange(payload, source) {
    window.dispatchEvent(new CustomEvent('familyrepositorychange', { detail: { payload, source } }));
  }
  async function persist(data) {
    FamilyModel.build(data);
    const saved = { data, version: crypto.randomUUID(), savedAt: Date.now() };
    const sync = { ...(await getSyncState()), dirty: true };
    try { await recordPutMany([['current', saved], ['sync', sync]]); }
    catch { throw new Error('瀏覽器 IndexedDB 儲存空間不足或不允許儲存，本次變更尚未儲存。'); }
    emitChange(saved, 'local');
    return saved;
  }
  async function replaceFromCloud(data, remote = {}, expectedLocalVersion = null) {
    if (!isStatic) throw new Error('開發模式不支援以 Google Drive 取代本機 API 資料。');
    FamilyModel.build(data);
    const db = await openDb();
    const result = await new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const currentRequest = store.get('current');
      const syncRequest = store.get('sync');
      let saved, sync, changed = false, settled = false;
      const apply = () => {
        if (currentRequest.readyState !== 'done' || syncRequest.readyState !== 'done' || saved) return;
        const current = currentRequest.result?.value || { data: defaultData(), version: 'empty' };
        if (expectedLocalVersion && current.version !== expectedLocalVersion) {
          const error = new Error('同步期間此裝置又有新的修改，已停止下載以避免覆蓋。');
          error.code = 'LOCAL_CHANGED';
          settled = true;
          try { tx.abort(); } catch {}
          reject(error);
          return;
        }
        changed = !FamilyModel.sameJsonData(current.data, data);
        saved = changed ? { data, version: crypto.randomUUID(), savedAt: Date.now() } : current;
        sync = {
          ...(syncRequest.result?.value || {}),
          fileId: remote.fileId || null,
          remoteVersion: remote.remoteVersion || null,
          dirty: false,
          connected: true,
          lastSyncedAt: Date.now()
        };
        if (changed) store.put({ key: 'current', value: saved });
        store.put({ key: 'sync', value: sync });
      };
      currentRequest.onsuccess = apply;
      syncRequest.onsuccess = apply;
      currentRequest.onerror = () => { if (!settled) { settled = true; reject(currentRequest.error || new Error('無法讀取本機族譜版本。')); } };
      syncRequest.onerror = () => { if (!settled) { settled = true; reject(syncRequest.error || new Error('無法讀取同步狀態。')); } };
      tx.oncomplete = () => { if (!settled) { settled = true; resolve({ saved, sync, changed }); } };
      tx.onerror = () => { if (!settled) { settled = true; reject(tx.error || new Error('無法寫入 Google Drive 下載資料。')); } };
      tx.onabort = () => { if (!settled) { settled = true; reject(tx.error || new Error('Google Drive 下載資料寫入已取消。')); } };
    });
    if (result.changed) emitChange(result.saved, 'cloud');
    window.dispatchEvent(new CustomEvent('familyreposyncstate', { detail: result.sync }));
    return result.saved;
  }
  async function markCloudSynced(remote = {}, expectedLocalVersion = null) {
    const db = await openDb();
    const state = await new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const currentRequest = store.get('current');
      const syncRequest = store.get('sync');
      let next;
      const apply = () => {
        if (currentRequest.readyState !== 'done' || syncRequest.readyState !== 'done' || next) return;
        const current = currentRequest.result?.value || { data: defaultData(), version: 'empty' };
        next = {
          ...(syncRequest.result?.value || {}),
          fileId: remote.fileId || null,
          remoteVersion: remote.remoteVersion || null,
          dirty: expectedLocalVersion ? current.version !== expectedLocalVersion : false,
          connected: true,
          lastSyncedAt: Date.now()
        };
        store.put({ key: 'sync', value: next });
      };
      currentRequest.onsuccess = apply;
      syncRequest.onsuccess = apply;
      currentRequest.onerror = () => reject(currentRequest.error || new Error('無法讀取本機族譜版本。'));
      syncRequest.onerror = () => reject(syncRequest.error || new Error('無法讀取同步狀態。'));
      tx.oncomplete = () => resolve(next);
      tx.onerror = () => reject(tx.error || new Error('無法更新同步狀態。'));
      tx.onabort = () => reject(tx.error || new Error('同步狀態更新已取消。'));
    });
    window.dispatchEvent(new CustomEvent('familyreposyncstate', { detail: state }));
    return state;
  }
  async function backupBeforeImport(payload) {
    await recordPut('before-import', { ...payload, savedAt: Date.now() });
  }
  async function localRequest(url, options) {
    const current = await read(), method = options.method || 'GET';
    if (method === 'GET') return response(url.endsWith('/export') ? current.data : current);
    const body = JSON.parse(options.body), memberId = url.startsWith('/api/members/') ? decodeURIComponent(url.split('/').at(-1)) : null;
    const adding = url === '/api/members' && method === 'POST';
    let member;
    if (adding || memberId) {
      if (adding && !/^[0-9a-f-]{36}$/i.test(body.requestId || '')) throw new Error('新增請求格式不正確。');
      member = { ...body.member, id: memberId || 'p-' + body.requestId };
      FamilyModel.validateMember(member);
      const existing = adding && current.data.people.find(p => p.id === member.id);
      if (existing) return JSON.stringify(existing) === JSON.stringify(member) ? response({ ...current, memberId: member.id }) : response({ error: '此成員已新增，請重新開啟表單。' }, 409);
    }
    if (body.version !== current.version) return response({ error: '資料已在其他分頁或雲端更新，請更新資料後再儲存。' }, 409);
    let data;
    if (adding) data = { ...current.data, people: [...current.data.people, member] };
    else if (memberId) data = FamilyModel.replaceMember(current.data, member);
    else if (url === '/api/family/name') data = { ...current.data, familyName: FamilyModel.normalizeFamilyName(body.familyName) };
    else if (url === '/api/family/import') {
      FamilyModel.build(body.data);
      try { await backupBeforeImport(current); }
      catch { throw new Error('無法保留匯入前的 IndexedDB 備份，尚未匯入。請先匯出目前資料並清理瀏覽器空間。'); }
      data = body.data;
    } else return response({ error: '不支援的操作。' }, 404);
    const saved = await persist(data);
    return response({ ...saved, ...(member ? { memberId: member.id } : {}), ...(url.endsWith('/import') ? { backupCreated: true } : {}) });
  }
  async function request(url, options = {}) {
    if (!isStatic) return fetch(url, options);
    try {
      const run = () => localRequest(url, options);
      if ((options.method || 'GET') !== 'GET' && navigator.locks) return await navigator.locks.request(dbName, run);
      return await run();
    } catch (error) { return response({ error: error.message || '無法存取瀏覽器族譜資料。' }, 400); }
  }
  function isPristine(data) {
    if (!data || !Array.isArray(data.people) || data.people.length !== 0) return false;
    const name = data.familyName == null ? '我的家族' : String(data.familyName).trim();
    return !name || name === '我的家族';
  }

  window.FamilyRepository = {
    isStatic,
    request,
    read,
    getSyncState,
    setSyncState,
    replaceFromCloud,
    markCloudSynced,
    isPristine,
    storageLabel: isStatic ? 'IndexedDB' : 'API'
  };
})();
