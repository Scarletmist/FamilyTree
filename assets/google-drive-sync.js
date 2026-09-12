/* Optional Google Drive appDataFolder sync for the static GitHub Pages build. */
(function () {
  'use strict';
  const repository = window.FamilyRepository;
  const button = document.getElementById('cloud-sync');
  const dialog = document.getElementById('cloud-sync-dialog');
  const action = document.getElementById('cloud-sync-action');
  const disconnect = document.getElementById('cloud-sync-disconnect');
  const message = document.getElementById('cloud-sync-message');
  const meta = document.getElementById('cloud-sync-meta');
  const conflictDialog = document.getElementById('cloud-conflict-dialog');
  const clientId = document.querySelector('meta[name="google-oauth-client-id"]')?.content?.trim() || window.FAMILY_GOOGLE_CLIENT_ID || '';
  const scope = 'https://www.googleapis.com/auth/drive.appdata';
  const fileName = 'family-tree.json';
  const driveBase = 'https://www.googleapis.com/drive/v3/files';
  const uploadBase = 'https://www.googleapis.com/upload/drive/v3/files';
  let accessToken = null;
  let tokenExpiresAt = 0;
  let syncConnected = false;
  let tokenClient = null;
  let tokenClientPromise = null;
  let authInFlight = null;
  let authResolve = null;
  let authReject = null;
  let syncInFlight = null;
  let autoTimer = null;
  let pollTimer = null;
  let conflictResolver = null;
  const tokenStorageKey = 'family-tree-google-drive-token-v1';
  const TOKEN_VALIDITY_MARGIN_MS = 30_000;
  const TOKEN_REFRESH_WINDOW_MS = 5 * 60_000;
  const opportunisticGestureSelector = [
    '#add-member',
    '#save-member',
    '#edit-family-name',
    '#save-family-name',
    '#confirm-import',
    '.edit-member',
    '.intermediate-ignore-button',
    '#ignored-intermediate-list button',
    '.save-status__action'
  ].join(',');

  function clearStoredToken() {
    try { sessionStorage.removeItem(tokenStorageKey); } catch {}
  }

  function persistToken() {
    if (!accessToken || !Number.isFinite(tokenExpiresAt)) return;
    try {
      sessionStorage.setItem(tokenStorageKey, JSON.stringify({
        accessToken,
        tokenExpiresAt,
        scope,
        clientId
      }));
    } catch {}
  }

  function restoreStoredToken() {
    try {
      const raw = sessionStorage.getItem(tokenStorageKey);
      if (!raw) return false;
      const saved = JSON.parse(raw);
      const expiresAt = Number(saved?.tokenExpiresAt || 0);
      const sameGrant = saved?.clientId === clientId && saved?.scope === scope;
      if (!sameGrant || !saved?.accessToken || expiresAt <= Date.now() + TOKEN_VALIDITY_MARGIN_MS) {
        clearStoredToken();
        return false;
      }
      accessToken = saved.accessToken;
      tokenExpiresAt = expiresAt;
      return true;
    } catch {
      clearStoredToken();
      return false;
    }
  }

  if (!button || !repository?.isStatic) {
    if (button) button.hidden = true;
    return;
  }

  function setUi(state, text, detail = '') {
    button.dataset.syncState = state;
    button.title = text;
    button.setAttribute('aria-label', text);
    const label = document.getElementById('cloud-sync-button-text');
    if (label) label.textContent = state === 'synced' ? '已同步' : state === 'syncing' ? '同步中' : state === 'conflict' ? '有衝突' : '雲端';
    if (message) message.textContent = text;
    if (meta) meta.textContent = detail;
  }
  function formatTime(value) {
    if (!value) return '';
    try { return new Intl.DateTimeFormat('zh-TW', { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(value)); }
    catch { return new Date(value).toLocaleString(); }
  }
  async function refreshUiFromState() {
    const state = await repository.getSyncState();
    syncConnected = Boolean(state.connected);
    disconnect.hidden = !state.connected;
    if (!clientId) {
      action.disabled = true;
      action.textContent = '尚未設定 Google OAuth Client ID';
      setUi('unconfigured', 'Google Drive 同步尚未設定', '請在 GitHub Actions 建置時提供 GOOGLE_OAUTH_CLIENT_ID。');
      return;
    }
    action.disabled = false;
    action.textContent = accessToken ? '立即同步' : state.connected ? '重新授權並同步' : '連結 Google Drive';
    if (accessToken && Date.now() < tokenExpiresAt && !state.dirty) setUi('synced', 'Google Drive 已同步', state.lastSyncedAt ? '上次同步：' + formatTime(state.lastSyncedAt) : '已連結 Google Drive appDataFolder。');
    else if (state.connected) setUi(state.dirty ? 'pending' : 'connected', state.dirty ? '此裝置有尚未同步的變更；下次操作時會嘗試恢復同步' : 'Google Drive 已連結；下次操作時會自動嘗試恢復同步', state.lastSyncedAt ? '上次同步：' + formatTime(state.lastSyncedAt) : '族譜仍安全保存在 IndexedDB。');
    else setUi('disconnected', '連結 Google Drive 以跨裝置同步', '族譜目前只儲存在此瀏覽器的 IndexedDB。');
  }
  function loadGoogleIdentity() {
    if (window.google?.accounts?.oauth2) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-google-identity-services]');
      if (existing) {
        existing.addEventListener('load', resolve, { once: true });
        existing.addEventListener('error', () => reject(new Error('無法載入 Google 登入服務。')), { once: true });
        return;
      }
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.dataset.googleIdentityServices = 'true';
      script.onload = resolve;
      script.onerror = () => reject(new Error('無法載入 Google 登入服務，請檢查網路或內容阻擋設定。'));
      document.head.appendChild(script);
    });
  }
  function hasUsableToken(minRemaining = TOKEN_VALIDITY_MARGIN_MS) {
    return Boolean(accessToken) && Date.now() < tokenExpiresAt - minRemaining;
  }
  function tokenNeedsGestureRefresh() {
    if (!syncConnected) return false;
    if (!accessToken) return true;
    return Date.now() >= tokenExpiresAt - TOKEN_REFRESH_WINDOW_MS;
  }
  function finishAuthorization(result, error = null) {
    const resolve = authResolve, reject = authReject;
    authResolve = null; authReject = null; authInFlight = null;
    if (error) { reject?.(error); return; }
    resolve?.(result);
  }
  async function ensureTokenClient() {
    if (tokenClient) return tokenClient;
    if (tokenClientPromise) return tokenClientPromise;
    tokenClientPromise = (async () => {
      await loadGoogleIdentity();
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope,
        prompt: '',
        callback: result => {
          if (result.error || !result.access_token) {
            finishAuthorization(null, new Error(result.error_description || result.error || 'Google 授權未完成。'));
            return;
          }
          accessToken = result.access_token;
          tokenExpiresAt = Date.now() + Math.max(60, Number(result.expires_in) || 3600) * 1000;
          syncConnected = true;
          persistToken();
          repository.setSyncState({ connected: true }).catch(() => {});
          startPolling();
          finishAuthorization(accessToken);
        },
        error_callback: error => {
          const reason = error?.type === 'popup_closed' ? 'Google 授權視窗已關閉。' : error?.type === 'popup_failed_to_open' ? '瀏覽器阻擋了 Google 授權視窗。' : 'Google 授權未完成。';
          finishAuthorization(null, new Error(reason));
        }
      });
      return tokenClient;
    })().finally(() => { tokenClientPromise = null; });
    return tokenClientPromise;
  }
  function requestTokenFromPreparedClient() {
    if (!tokenClient) return null;
    if (authInFlight) return authInFlight;
    authInFlight = new Promise((resolve, reject) => { authResolve = resolve; authReject = reject; });
    const pending = authInFlight;
    try {
      // Empty prompt reuses an existing Google grant/session when possible. The
      // request is intentionally issued directly from the user's click handler.
      tokenClient.requestAccessToken({ prompt: '' });
    } catch (error) {
      finishAuthorization(null, error);
    }
    return pending;
  }
  async function authorize() {
    if (!clientId) throw new Error('尚未設定 Google OAuth Client ID。');
    if (hasUsableToken()) return accessToken;
    await ensureTokenClient();
    return requestTokenFromPreparedClient();
  }
  function prepareAuthorization() {
    if (!clientId || !syncConnected || tokenClient) return;
    ensureTokenClient().catch(() => {});
  }
  function opportunisticAuthorizeFromGesture() {
    if (!clientId || !tokenNeedsGestureRefresh()) return;
    // requestAccessToken must be called from the user-driven event. If GIS has
    // not finished preloading yet, prepare it now and use the next normal click.
    if (!tokenClient) { prepareAuthorization(); return; }
    const pending = requestTokenFromPreparedClient();
    if (!pending) return;
    pending
      .then(() => navigator.onLine ? syncNow({ interactive: false }) : null)
      .catch(() => refreshUiFromState().catch(() => {}));
  }
  async function driveFetch(url, options = {}) {
    if (!accessToken || Date.now() >= tokenExpiresAt - 5_000) throw new Error('Google 授權已過期；請在下一次操作時允許恢復同步，或開啟雲端面板重新授權。');
    const response = await fetch(url, {
      ...options,
      headers: { ...(options.headers || {}), Authorization: 'Bearer ' + accessToken }
    });
    if (response.status === 401) {
      accessToken = null;
      tokenExpiresAt = 0;
      clearStoredToken();
      stopPolling();
      prepareAuthorization();
      await refreshUiFromState();
      throw new Error('Google 授權已過期；下次操作時會自動嘗試恢復同步。');
    }
    if (!response.ok) {
      let detail = '';
      try { detail = (await response.json())?.error?.message || ''; } catch {}
      throw new Error(detail || `Google Drive API 發生錯誤（${response.status}）。`);
    }
    return response;
  }
  async function findRemote() {
    const query = `'appDataFolder' in parents and name = '${fileName.replaceAll("'", "\\'")}' and trashed = false`;
    const params = new URLSearchParams({
      spaces: 'appDataFolder',
      q: query,
      orderBy: 'modifiedTime desc',
      pageSize: '10',
      fields: 'files(id,name,version,modifiedTime,size)'
    });
    const payload = await (await driveFetch(driveBase + '?' + params)).json();
    return payload.files?.[0] || null;
  }
  function multipartBody(metadata, data) {
    const boundary = 'family_tree_' + crypto.randomUUID().replaceAll('-', '');
    const json = JSON.stringify(data, null, 2);
    const body = new Blob([
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
      JSON.stringify(metadata),
      `\r\n--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
      json,
      `\r\n--${boundary}--`
    ]);
    return { body, contentType: `multipart/related; boundary=${boundary}` };
  }
  async function createRemote(data) {
    const multipart = multipartBody({ name: fileName, mimeType: 'application/json', parents: ['appDataFolder'] }, data);
    const params = new URLSearchParams({ uploadType: 'multipart', fields: 'id,name,version,modifiedTime,size' });
    return (await (await driveFetch(uploadBase + '?' + params, {
      method: 'POST',
      headers: { 'Content-Type': multipart.contentType },
      body: multipart.body
    })).json());
  }
  async function updateRemote(fileId, data) {
    const params = new URLSearchParams({ uploadType: 'media', fields: 'id,name,version,modifiedTime,size' });
    return (await (await driveFetch(`${uploadBase}/${encodeURIComponent(fileId)}?${params}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify(data, null, 2)
    })).json());
  }
  async function downloadRemote(remote) {
    const response = await driveFetch(`${driveBase}/${encodeURIComponent(remote.id)}?alt=media`);
    let data;
    try { data = JSON.parse((await response.text()).replace(/^\uFEFF/, '')); }
    catch { throw new Error('Google Drive 上的族譜檔案不是有效的 JSON。'); }
    FamilyModel.build(data);
    return data;
  }
  function waitForConflictChoice(local, remote) {
    if (!conflictDialog) return Promise.resolve('cloud');
    document.getElementById('cloud-conflict-local-summary').textContent = `此裝置：${local.data.people.length} 位成員`;
    document.getElementById('cloud-conflict-remote-summary').textContent = `Google Drive：更新時間 ${formatTime(remote.modifiedTime) || '未知'}`;
    conflictDialog.showModal();
    return new Promise(resolve => { conflictResolver = resolve; });
  }
  function resolveConflict(choice) {
    if (!conflictResolver) return;
    const resolve = conflictResolver;
    conflictResolver = null;
    conflictDialog.close();
    resolve(choice);
  }
  document.getElementById('cloud-conflict-use-local')?.addEventListener('click', () => resolveConflict('local'));
  document.getElementById('cloud-conflict-use-remote')?.addEventListener('click', () => resolveConflict('cloud'));
  document.getElementById('cloud-conflict-cancel')?.addEventListener('click', () => resolveConflict('cancel'));
  conflictDialog?.addEventListener('cancel', event => { event.preventDefault(); resolveConflict('cancel'); });

  async function handleConflict(local, remote, interactive) {
    setUi('conflict', '此裝置與 Google Drive 都有不同的族譜版本', '請選擇要保留哪一份資料。');
    if (!interactive) return { outcome: 'conflict' };
    const choice = await waitForConflictChoice(local, remote);
    if (choice === 'cancel') return { outcome: 'cancelled' };
    if (choice === 'local') {
      setUi('syncing', '正在以此裝置資料更新 Google Drive…');
      const uploaded = await updateRemote(remote.id, local.data);
      await repository.markCloudSynced({ fileId: uploaded.id, remoteVersion: uploaded.version }, local.version);
      return { outcome: 'uploaded', remote: uploaded };
    }
    setUi('syncing', '正在從 Google Drive 載入族譜…');
    const data = await downloadRemote(remote);
    await repository.replaceFromCloud(data, { fileId: remote.id, remoteVersion: remote.version }, local.version);
    return { outcome: 'downloaded', remote };
  }
  async function doSync(interactive) {
    if (!navigator.onLine) throw new Error('目前離線；資料已保存在 IndexedDB，恢復網路後再同步。');
    if (!accessToken || Date.now() >= tokenExpiresAt - TOKEN_VALIDITY_MARGIN_MS) {
      if (!interactive) {
        await refreshUiFromState();
        return { outcome: 'needs-auth' };
      }
      setUi('syncing', '正在取得 Google 授權…');
      await authorize();
    }
    setUi('syncing', '正在檢查 Google Drive…');
    const [local, state, remote] = await Promise.all([repository.read(), repository.getSyncState(), findRemote()]);
    if (!remote) {
      setUi('syncing', '正在建立 Google Drive 雲端族譜…');
      const created = await createRemote(local.data);
      await repository.markCloudSynced({ fileId: created.id, remoteVersion: created.version }, local.version);
      return { outcome: 'created', remote: created };
    }

    const sameFile = state.fileId === remote.id;
    const knowsRemoteVersion = sameFile && typeof state.remoteVersion === 'string' && state.remoteVersion.length > 0;
    if (!knowsRemoteVersion) {
      if (repository.isPristine(local.data) && !state.dirty) {
        setUi('syncing', '正在從 Google Drive 載入族譜…');
        const data = await downloadRemote(remote);
        await repository.replaceFromCloud(data, { fileId: remote.id, remoteVersion: remote.version }, local.version);
        return { outcome: 'downloaded', remote };
      }
      return handleConflict(local, remote, interactive);
    }

    if (remote.version !== state.remoteVersion) {
      if (state.dirty) return handleConflict(local, remote, interactive);
      setUi('syncing', 'Google Drive 有較新資料，正在下載…');
      const data = await downloadRemote(remote);
      await repository.replaceFromCloud(data, { fileId: remote.id, remoteVersion: remote.version }, local.version);
      return { outcome: 'downloaded', remote };
    }

    if (state.dirty) {
      setUi('syncing', '正在將此裝置的變更上傳至 Google Drive…');
      const uploaded = await updateRemote(remote.id, local.data);
      await repository.markCloudSynced({ fileId: uploaded.id, remoteVersion: uploaded.version }, local.version);
      return { outcome: 'uploaded', remote: uploaded };
    }
    await repository.markCloudSynced({ fileId: remote.id, remoteVersion: remote.version }, local.version);
    return { outcome: 'unchanged', remote };
  }
  async function syncNow({ interactive = true } = {}) {
    if (syncInFlight) return syncInFlight;
    syncInFlight = (async () => {
      try {
        const result = await doSync(interactive);
        if (!['conflict', 'cancelled', 'needs-auth'].includes(result.outcome)) {
          const state = await repository.getSyncState();
          setUi('synced', 'Google Drive 已同步', '上次同步：' + formatTime(state.lastSyncedAt));
        }
        return result;
      } catch (error) {
        const state = await repository.getSyncState().catch(() => ({ dirty: true }));
        setUi(state.dirty ? 'pending' : 'error', error.message || 'Google Drive 同步失敗。', '本機 IndexedDB 資料不受影響。');
        if (interactive && message) message.textContent = error.message || 'Google Drive 同步失敗。';
        return { outcome: 'error', error };
      } finally {
        syncInFlight = null;
        await refreshActionOnly();
      }
    })();
    return syncInFlight;
  }
  async function refreshActionOnly() {
    const state = await repository.getSyncState().catch(() => ({ connected: false }));
    syncConnected = Boolean(state.connected);
    disconnect.hidden = !state.connected;
    if (syncConnected) prepareAuthorization();
    if (!clientId) return;
    action.disabled = false;
    action.textContent = accessToken ? '立即同步' : state.connected ? '重新授權並同步' : '連結 Google Drive';
  }
  function scheduleAutoSync() {
    if (!accessToken) return;
    clearTimeout(autoTimer);
    autoTimer = setTimeout(() => syncNow({ interactive: false }), 1800);
  }
  function startPolling() {
    stopPolling();
    pollTimer = setInterval(() => {
      if (!document.hidden && accessToken && navigator.onLine) syncNow({ interactive: false });
    }, 60_000);
  }
  function stopPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  }

  button.addEventListener('click', async () => {
    await refreshUiFromState();
    dialog.showModal();
    if (clientId) ensureTokenClient().catch(() => {});
  });
  document.getElementById('close-cloud-sync-dialog')?.addEventListener('click', () => dialog.close());
  dialog.addEventListener('cancel', () => {});
  action.addEventListener('click', async () => {
    await syncNow({ interactive: true });
  });
  disconnect.addEventListener('click', async () => {
    accessToken = null;
    syncConnected = false;
    tokenExpiresAt = 0;
    clearStoredToken();
    stopPolling();
    await repository.setSyncState({ connected: false });
    setUi('disconnected', '已停止此裝置的 Google Drive 同步', '本程式不會刪除 Google Drive 上既有的 appDataFolder 資料；若要撤銷帳號授權，請至 Google 帳戶的第三方應用程式設定。');
    await refreshActionOnly();
  });

  window.addEventListener('familyrepositorychange', event => {
    if (event.detail?.source === 'local') scheduleAutoSync();
  });
  window.addEventListener('familyreposyncstate', event => {
    syncConnected = Boolean(event.detail?.connected);
    if (syncConnected) prepareAuthorization();
    refreshActionOnly();
  });
  window.addEventListener('online', () => { if (accessToken) syncNow({ interactive: false }); });
  window.addEventListener('focus', () => { if (accessToken && navigator.onLine) syncNow({ interactive: false }); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && accessToken && navigator.onLine) syncNow({ interactive: false }); });
  document.addEventListener('click', event => {
    const target = event.target.closest?.(opportunisticGestureSelector);
    if (!target || target.disabled || target.closest('#cloud-sync-dialog')) return;
    opportunisticAuthorizeFromGesture();
  }, true);
  window.addEventListener('beforeunload', stopPolling);

  (async () => {
    const restoredSessionToken = restoreStoredToken();
    try {
      await refreshUiFromState();
      if (syncConnected) prepareAuthorization();
      if (restoredSessionToken) {
        startPolling();
        if (navigator.onLine) syncNow({ interactive: false });
      }
    } catch (error) {
      setUi('error', error.message || '無法讀取同步狀態。');
    }
  })();
  window.FamilyGoogleDriveSync = { syncNow, prepareAuthorization };
})();
