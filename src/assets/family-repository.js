/* Persistence boundary. GitHub Pages uses IndexedDB as the primary store; HTTP exists only as a local dev adapter. */
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
  const HISTORY_LIMIT = 10;
  const defaultData = () => ({ schemaVersion: 2, familyName: '我的家族', people: [] });
  const emptySyncState = () => ({ fileId: null, remoteVersion: null, dirty: false, connected: false, lastSyncedAt: null });
  let dbPromise = null;
  let dbConnection = null;
  const resetKey = 'family-tree:device-reset:' + storagePath;
  let resetting = false, resetWork = null, resetId = null;
  let resetChannel = null;
  if (isStatic) {
    try {
      resetChannel = new BroadcastChannel(resetKey);
      resetChannel.onmessage = event => receiveReset(event.data);
    } catch {}
    window.addEventListener('storage', event => {
      if (event.key !== resetKey || !event.newValue) return;
      try { receiveReset(JSON.parse(event.newValue)); } catch {}
    });
  }

  function deviceResetVersion() {
    try { return JSON.parse(localStorage.getItem(resetKey) || 'null')?.id || ''; }
    catch { return ''; }
  }
  function clearDeviceSession() {
    for (const key of ['family-tree-google-drive-token-v1', 'family-tree:member-form-draft:v1', 'family-tree:canvas-view:v1:' + location.pathname]) {
      try { sessionStorage.removeItem(key); } catch {}
    }
  }
  function beginReset(id) {
    resetId = id;
    resetting = true;
    clearDeviceSession();
    if (dbConnection) invalidateDb(dbConnection);
    window.dispatchEvent(new CustomEvent('familydevicereset', { detail: { phase: 'start', id } }));
  }
  function receiveReset(detail) {
    if (!detail || typeof detail.id !== 'string') return;
    if (detail.phase === 'start' && resetId !== detail.id) beginReset(detail.id);
    else if (['complete', 'failed'].includes(detail.phase) && resetId === detail.id) {
      if (detail.phase === 'failed') resetting = false;
      resetId = null;
      window.dispatchEvent(new CustomEvent('familydevicereset', { detail }));
    }
  }
  function publishReset(phase, id) {
    const detail = { phase, id };
    try { localStorage.setItem(resetKey, JSON.stringify(detail)); } catch {}
    try { resetChannel?.postMessage(detail); } catch {}
    if (phase !== 'start') receiveReset(detail);
  }
  async function resetDevice({ onBlocked = () => {} } = {}) {
    if (!isStatic) throw repositoryError('只有此瀏覽器儲存模式支援重置裝置資料。');
    if (resetWork) return resetWork;
    if (resetting) throw repositoryError('其他分頁正在重置此裝置資料，請等待完成。');
    const id = crypto.randomUUID();
    beginReset(id);
    publishReset('start', id);
    resetWork = (async () => {
      try {
        // Do not read the damaged store or use an import command: remove only
        // this site's device database, including history, backups and caches.
        await new Promise((resolve, reject) => {
          const request = indexedDB.deleteDatabase(dbName);
          request.onsuccess = () => resolve();
          request.onerror = () => reject(request.error || repositoryError('無法清除此裝置的族譜資料。'));
          // A blocked delete remains pending; do not report completion early.
          request.onblocked = () => onBlocked();
        });
        for (const key of [legacyKey, legacyKey + ':before-import', 'family-tree:location-settings:' + storagePath]) {
          localStorage.removeItem(key);
        }
        for (const pathname of new Set([storagePath, location.pathname, storagePath + 'index.html', storagePath + 'family-tree.html'])) {
          localStorage.removeItem('family-tree:recent-members:v1:' + pathname);
        }
        clearDeviceSession();
        publishReset('complete', id);
      } catch (error) {
        publishReset('failed', id);
        throw error;
      } finally { resetWork = null; }
    })();
    return resetWork;
  }

  function repositoryError(message, status = 400, code = 'STORE_ERROR') {
    return Object.assign(new Error(message), { status, code });
  }
  function assertPayload(payload) {
    if (!payload || typeof payload !== 'object' || typeof payload.version !== 'string') throw new Error('瀏覽器族譜資料格式不正確。');
    FamilyModel.build(payload.data);
    return payload;
  }
  function invalidateDb(db) {
    if (dbConnection !== db) return;
    dbConnection = null;
    dbPromise = null;
    db.close();
  }
  function openDb() {
    if (resetting) return Promise.reject(repositoryError('此裝置資料正在重置，請等待頁面重新載入。', 409, 'DEVICE_RESETTING'));
    if (!isStatic) return Promise.reject(new Error('開發模式不使用 IndexedDB 儲存族譜。'));
    if (!('indexedDB' in window)) return Promise.reject(new Error('此瀏覽器不支援 IndexedDB。'));
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(dbName, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(storeName)) db.createObjectStore(storeName, { keyPath: 'key' });
      };
      request.onsuccess = () => {
        const db = request.result;
        if (resetting) { db.close(); reject(repositoryError('此裝置資料正在重置。', 409, 'DEVICE_RESETTING')); return; }
        dbConnection = db;
        db.onclose = () => invalidateDb(db);
        db.onversionchange = () => invalidateDb(db);
        resolve(db);
      };
      request.onerror = () => reject(request.error || new Error('無法開啟 IndexedDB。'));
      request.onblocked = () => reject(new Error('IndexedDB 更新被其他分頁阻擋，請關閉其他族譜分頁後重試。'));
    }).catch(error => { dbPromise = null; throw error; });
    return dbPromise;
  }
  async function recordGet(key, retry = true) {
    let db;
    try {
      db = await openDb();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const request = tx.objectStore(storeName).get(key);
        let value = null;
        request.onsuccess = () => { value = request.result?.value ?? null; };
        request.onerror = () => reject(request.error || new Error('無法讀取 IndexedDB。'));
        tx.oncomplete = () => resolve(value);
        tx.onerror = () => reject(tx.error || new Error('無法讀取 IndexedDB。'));
        tx.onabort = () => reject(tx.error || new Error('IndexedDB 讀取已取消。'));
      });
    } catch (error) {
      if (!retry || !['UnknownError', 'InvalidStateError'].includes(error?.name)) throw error;
      // Retry only reads, reopening the existing database without replacing data.
      if (db) invalidateDb(db);
      return recordGet(key, false);
    }
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
    if (!legacy) return null;
    const entries = [
      ['current', { ...legacy, savedAt: Date.now() }],
      ['sync', { ...emptySyncState(), dirty: true }]
    ];
    try {
      const backupText = localStorage.getItem(legacyKey + ':before-import');
      if (backupText) entries.push(['before-import', { ...assertPayload(JSON.parse(backupText)), savedAt: Date.now() }]);
    } catch {}
    await recordPutMany(entries);
    try {
      localStorage.removeItem(legacyKey);
      localStorage.removeItem(legacyKey + ':before-import');
    } catch {}
    return legacy;
  }
  async function readStatic(attempt = 0) {
    const migrated = await migrateLegacy();
    const saved = migrated || await recordGet('current');
    if (!saved) return { data: defaultData(), version: 'empty' };
    const completed = FamilyModel.completeKinship(saved.data);
    if (completed !== saved.data) {
      try { return await executeStatic({ type: 'refreshKinship', expectedVersion: saved.version }); }
      catch (error) {
        if (error.status === 409 && attempt < 2) return readStatic(attempt + 1);
        throw error;
      }
    }
    const history = await recordGet('history');
    return { ...assertPayload(saved), undoLabel: history?.[0]?.label || null };
  }
  function emitChange(payload, source, detail = {}) {
    window.dispatchEvent(new CustomEvent('familyrepositorychange', { detail: { payload, source, ...detail } }));
  }

  async function executeStatic(command) {
    await migrateLegacy();
    const db = await openDb();
    let outcome;
    try {
      outcome = await new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        const currentRequest = store.get('current');
        const historyRequest = store.get('history');
        const syncRequest = store.get('sync');
        let result = null, applied = false, settled = false;

        const fail = error => {
          if (settled) return;
          settled = true;
          try { tx.abort(); } catch {}
          reject(error);
        };
        const apply = () => {
          if (applied || [currentRequest, historyRequest, syncRequest].some(request => request.readyState !== 'done')) return;
          applied = true;
          const current = currentRequest.result?.value || { data: defaultData(), version: 'empty' };
          const history = Array.isArray(historyRequest.result?.value) ? historyRequest.result.value : [];
          const sync = { ...emptySyncState(), ...(syncRequest.result?.value || {}) };
          if (command.expectedVersion && current.version !== command.expectedVersion) {
            // A lost response may be retried after its successful save. Computed
            // kinship metadata does not make that same member a different input.
            if (command.type === 'addMember') {
              try {
                const retry = FamilyCommands.apply(current.data, command);
                if (retry.unchanged) {
                  result = { ...current, memberId: retry.memberId, undoLabel: history[0]?.label || null };
                  return;
                }
              } catch {}
            }
            fail(repositoryError('資料已在其他分頁或雲端更新，請更新資料後再儲存。', 409, 'STALE_VERSION'));
            return;
          }
          let change;
          try { change = FamilyCommands.apply(current.data, command); }
          catch (error) {
            if (!error.status) error.status = 400;
            fail(error);
            return;
          }
          if (change.unchanged) {
            result = { ...current, undoLabel: history[0]?.label || null, ...(change.memberId ? { memberId: change.memberId } : {}) };
            return;
          }
          try { FamilyModel.build(change.data); }
          catch (error) {
            if (!error.status) error.status = 400;
            fail(error);
            return;
          }
          const saved = {
            data: change.data,
            version: crypto.randomUUID(),
            savedAt: Date.now(),
            undoLabel: change.metadataOnly ? (history[0]?.label || null) : change.label
          };
          const nextHistory = [{ data: current.data, version: current.version, savedAt: Date.now(), label: change.label }, ...history].slice(0, HISTORY_LIMIT);
          const nextSync = { ...sync, dirty: true };
          store.put({ key: 'current', value: saved });
          if (!change.metadataOnly) store.put({ key: 'history', value: nextHistory });
          store.put({ key: 'sync', value: nextSync });
          if (change.backupBeforeImport) store.put({ key: 'before-import', value: { ...current, savedAt: Date.now() } });
          result = {
            ...saved,
            ...(change.memberId ? { memberId: change.memberId } : {}),
            ...(change.backupBeforeImport ? { backupCreated: true } : {})
          };
        };

        currentRequest.onsuccess = apply;
        historyRequest.onsuccess = apply;
        syncRequest.onsuccess = apply;
        currentRequest.onerror = () => fail(currentRequest.error || repositoryError('無法讀取本機族譜版本。'));
        historyRequest.onerror = () => fail(historyRequest.error || repositoryError('無法讀取復原歷史。'));
        syncRequest.onerror = () => fail(syncRequest.error || repositoryError('無法讀取同步狀態。'));
        tx.oncomplete = () => { if (!settled) { settled = true; resolve(result); } };
        tx.onerror = () => { if (!settled) { settled = true; reject(tx.error || repositoryError('無法寫入 IndexedDB。')); } };
        tx.onabort = () => { if (!settled) { settled = true; reject(tx.error || repositoryError('IndexedDB 寫入已取消。')); } };
      });
    } catch (error) {
      if (error?.status) throw error;
      throw repositoryError('瀏覽器 IndexedDB 儲存空間不足或不允許儲存，本次變更尚未儲存。', 400, 'STORE_WRITE_FAILED');
    }
    if (outcome) emitChange(outcome, ['updateLocations','claimLocationLookup','resetLocation'].includes(command.type) ? 'geocode' : 'local');
    return outcome;
  }

  async function undoStatic(expectedVersion) {
    await migrateLegacy();
    const db = await openDb();
    let result;
    try {
      result = await new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        const currentRequest = store.get('current');
        const historyRequest = store.get('history');
        const syncRequest = store.get('sync');
        let outcome = null, applied = false, settled = false;
        const fail = error => {
          if (settled) return;
          settled = true;
          try { tx.abort(); } catch {}
          reject(error);
        };
        const apply = () => {
          if (applied || [currentRequest, historyRequest, syncRequest].some(request => request.readyState !== 'done')) return;
          applied = true;
          const current = currentRequest.result?.value || { data: defaultData(), version: 'empty' };
          const history = Array.isArray(historyRequest.result?.value) ? historyRequest.result.value : [];
          if (expectedVersion && current.version !== expectedVersion) {
            fail(repositoryError('資料已被其他操作更新，無法復原舊版本。請先更新資料。', 409, 'STALE_VERSION'));
            return;
          }
          if (!history.length) {
            fail(repositoryError('目前沒有可復原的修改。', 409, 'NO_UNDO'));
            return;
          }
          const target = history[0];
          let completed;
          try { completed = FamilyModel.completeKinship(target.data); }
          catch (error) {
            if (!error.status) error.status = 400;
            fail(error);
            return;
          }
          const saved = { data: completed, version: crypto.randomUUID(), savedAt: Date.now(), undoLabel: history[1]?.label || null };
          const sync = { ...emptySyncState(), ...(syncRequest.result?.value || {}), dirty: true };
          store.put({ key: 'current', value: saved });
          store.put({ key: 'history', value: history.slice(1) });
          store.put({ key: 'sync', value: sync });
          outcome = { ...saved, undoneLabel: target.label || '上一項修改' };
        };
        currentRequest.onsuccess = apply;
        historyRequest.onsuccess = apply;
        syncRequest.onsuccess = apply;
        currentRequest.onerror = () => fail(currentRequest.error || repositoryError('無法讀取本機族譜版本。'));
        historyRequest.onerror = () => fail(historyRequest.error || repositoryError('無法讀取復原歷史。'));
        syncRequest.onerror = () => fail(syncRequest.error || repositoryError('無法讀取同步狀態。'));
        tx.oncomplete = () => { if (!settled) { settled = true; resolve(outcome); } };
        tx.onerror = () => { if (!settled) { settled = true; reject(tx.error || repositoryError('無法復原上一項修改。')); } };
        tx.onabort = () => { if (!settled) { settled = true; reject(tx.error || repositoryError('復原操作已取消。')); } };
      });
    } catch (error) {
      if (error?.status) throw error;
      throw repositoryError('瀏覽器 IndexedDB 儲存空間不足或不允許儲存，本次復原尚未完成。', 400, 'STORE_WRITE_FAILED');
    }
    emitChange(result, 'local');
    return result;
  }

  async function devJson(url, options = {}) {
    const response = await fetch(url, options);
    let payload;
    try { payload = await response.json(); }
    catch { throw repositoryError('本機開發伺服器回傳無效資料。', response.status || 500, 'DEV_RESPONSE_INVALID'); }
    if (!response.ok) throw repositoryError(payload.error || '本機開發操作失敗。', response.status, 'DEV_REQUEST_FAILED');
    return payload;
  }

  async function load() {
    return isStatic ? readStatic() : devJson('/api/family', { cache: 'no-store' });
  }
  async function addMember({ member, requestId, version }) {
    return isStatic
      ? executeStatic({ type: 'addMember', member, requestId, expectedVersion: version })
      : devJson('/api/members', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ member, requestId, version }) });
  }
  async function updateMember(id, { member, version }) {
    return isStatic
      ? executeStatic({ type: 'updateMember', id, member, expectedVersion: version })
      : devJson('/api/members/' + encodeURIComponent(id), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ member, version }) });
  }
  async function updateFamilyName({ familyName, version }) {
    return isStatic
      ? executeStatic({ type: 'updateFamilyName', familyName, expectedVersion: version })
      : devJson('/api/family/name', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ familyName, version }) });
  }
  async function updateIntermediateIgnore({ planId, ignored, version }) {
    return isStatic
      ? executeStatic({ type: 'updateIntermediateIgnore', planId, ignored, expectedVersion: version })
      : devJson('/api/family/intermediate-ignore', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ planId, ignored, version }) });
  }
  async function manageFamily(body) {
    return isStatic
      ? executeStatic({ ...body, type: 'manageFamily', expectedVersion: body.version })
      : devJson('/api/family/manage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  }
  async function importFamily({ data, version }) {
    return isStatic
      ? executeStatic({ type: 'importFamily', data, expectedVersion: version })
      : devJson('/api/family/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data, version }) });
  }
  async function undo(expectedVersion) {
    return isStatic
      ? undoStatic(expectedVersion)
      : devJson('/api/family/undo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: expectedVersion }) });
  }
  async function exportData() {
    return isStatic ? (await readStatic()).data : devJson('/api/family/export', { cache: 'no-store' });
  }

  async function locationCommand(command) {
    return isStatic ? executeStatic(command) : devJson('/api/family/locations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(command) });
  }
  async function getLocationCache(key) { return isStatic ? recordGet('location-cache:' + key) : null; }
  async function setLocationCache(key, result) { if (isStatic) await recordPutMany([['location-cache:' + key, result]]); }
  async function clearLocationCache(key) { if (isStatic) await recordPutMany([['location-cache:' + key, null]]); }

  async function getSyncState() {
    if (!isStatic) return emptySyncState();
    const state = await recordGet('sync');
    return { ...emptySyncState(), ...(state || {}) };
  }
  async function setSyncState(patch) {
    if (!isStatic) return getSyncState();
    const db = await openDb();
    const state = await new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const request = store.get('sync');
      let next;
      request.onsuccess = () => {
        next = { ...emptySyncState(), ...(request.result?.value || {}), ...patch };
        store.put({ key: 'sync', value: next });
      };
      request.onerror = () => reject(request.error || new Error('無法讀取同步狀態。'));
      tx.oncomplete = () => resolve(next);
      tx.onerror = () => reject(tx.error || new Error('無法更新同步狀態。'));
      tx.onabort = () => reject(tx.error || new Error('同步狀態更新已取消。'));
    });
    window.dispatchEvent(new CustomEvent('familyreposyncstate', { detail: state }));
    return state;
  }
  async function replaceFromCloud(data, remote = {}, expectedLocalVersion = null) {
    if (!isStatic) throw new Error('開發模式不支援 Google Drive 同步。');
    FamilyModel.build(data);
    const completed = FamilyModel.completeKinship(data), enriched = completed !== data;
    data = completed;
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
          const error = repositoryError('同步期間此裝置又有新的修改，已停止下載以避免覆蓋。', 409, 'LOCAL_CHANGED');
          settled = true;
          try { tx.abort(); } catch {}
          reject(error);
          return;
        }
        changed = !FamilyModel.sameJsonData(current.data, data);
        saved = changed ? { data, version: crypto.randomUUID(), savedAt: Date.now() } : current;
        sync = {
          ...emptySyncState(),
          ...(syncRequest.result?.value || {}),
          fileId: remote.fileId || null,
          remoteVersion: remote.remoteVersion || null,
          dirty: enriched,
          connected: true,
          lastSyncedAt: Date.now()
        };
        if (changed) {
          store.put({ key: 'current', value: saved });
          store.put({ key: 'history', value: [] });
        }
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
    if (result.changed) emitChange(result.saved, 'cloud', { kinshipEnriched: enriched });
    window.dispatchEvent(new CustomEvent('familyreposyncstate', { detail: result.sync }));
    return result.saved;
  }
  async function markCloudSynced(remote = {}, expectedLocalVersion = null) {
    if (!isStatic) throw new Error('開發模式不支援 Google Drive 同步。');
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
          ...emptySyncState(),
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
  function isPristine(data) {
    if (!data || !Array.isArray(data.people) || data.people.length !== 0) return false;
    const name = data.familyName == null ? '我的家族' : String(data.familyName).trim();
    return !name || name === '我的家族';
  }

  window.FamilyRepository = {
    isStatic,
    resetDevice,
    deviceResetVersion,
    isResetting: () => resetting,
    load,
    read: load,
    addMember,
    updateMember,
    updateFamilyName,
    updateIntermediateIgnore,
    manageFamily,
    importFamily,
    undo,
    exportData,
    locationCommand,
    getLocationCache,
    setLocationCache,
    clearLocationCache,
    getSyncState,
    setSyncState,
    replaceFromCloud,
    markCloudSynced,
    isPristine,
    storageLabel: isStatic ? 'IndexedDB' : 'Dev API'
  };
})();
