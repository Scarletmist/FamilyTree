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
  const alertButton = document.getElementById('cloud-sync-alert');
  const alertText = document.getElementById('cloud-sync-alert-text');
  const resetSection = document.getElementById('cloud-sync-reset-section');
  const resetButton = document.getElementById('cloud-sync-reset-device');
  const resetDialog = document.getElementById('cloud-reset-device-dialog');
  const resetConfirm = document.getElementById('cloud-reset-device-confirm');
  const resetCancel = document.getElementById('cloud-reset-device-cancel');
  const resetStatus = document.getElementById('cloud-reset-device-status');
  const resetError = document.getElementById('cloud-reset-device-error');
  const authToast = document.getElementById('cloud-auth-toast');
  const authToastText = document.getElementById('cloud-auth-toast-text');
  const conflictDialog = document.getElementById('cloud-conflict-dialog');
  const clientId = document.querySelector('meta[name="google-oauth-client-id"]')?.content?.trim() || window.FAMILY_GOOGLE_CLIENT_ID || '';
  const scope = 'https://www.googleapis.com/auth/drive.appdata';
  const fileName = 'family-tree.json';
  let accessToken = null;
  let tokenExpiresAt = 0;
  let syncConnected = false;
  let syncStateUnavailable = false;
  let deviceResetRequested = false, resetBusy = false;
  let tokenClient = null;
  let tokenClientPromise = null;
  let authInFlight = null;
  let authResolve = null;
  let authReject = null;
  let syncInFlight = null;
  let autoTimer = null;
  let pollTimer = null;
  let conflictResolver = null;
  let authToastTimer = null;
  let authPurpose = null;
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
        clientId,
        deviceResetVersion: repository.deviceResetVersion?.() || ''
      }));
    } catch {}
  }

  function restoreStoredToken() {
    try {
      const raw = sessionStorage.getItem(tokenStorageKey);
      if (!raw) return false;
      const saved = JSON.parse(raw);
      const expiresAt = Number(saved?.tokenExpiresAt || 0);
      const sameGrant = saved?.clientId === clientId && saved?.scope === scope
        && (saved?.deviceResetVersion || '') === (repository.deviceResetVersion?.() || '');
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

  function hideAuthToast() {
    if (authToastTimer) clearTimeout(authToastTimer);
    authToastTimer = null;
    if (authToast) authToast.hidden = true;
  }
  function showAuthToast(state, text, autoHideMs = 0) {
    if (!authToast || !authToastText) return;
    if (authToastTimer) clearTimeout(authToastTimer);
    authToastTimer = null;
    authToast.dataset.authState = state;
    authToastText.textContent = text;
    authToast.hidden = false;
    window.dispatchEvent(new CustomEvent('cloudauthchange', { detail:{ state, text } }));
    if (autoHideMs > 0) {
      authToastTimer = setTimeout(() => {
        authToast.hidden = true;
        authToastTimer = null;
      }, autoHideMs);
    }
  }
  function authPurposeLabel(purpose = authPurpose) {
    return purpose === 'connect' ? '正在連結 Google Drive…' : '正在更新 Google Drive 雲端連線…';
  }
  function completeAuthToast(success, error = null) {
    const purpose = authPurpose;
    if (success) {
      showAuthToast('success', purpose === 'connect' ? 'Google Drive 已連結，正在同步資料。' : 'Google Drive 雲端連線已更新。', 2200);
      return;
    }
    const text = error?.message || 'Google Drive 雲端連線更新未完成。';
    showAuthToast(error?.message?.includes('已關閉') ? 'warning' : 'error', text, 5200);
  }
  function setUi(state, text, detail = '') {
    button.dataset.syncState = state;
    button.title = text;
    button.setAttribute('aria-label', text);
    const label = document.getElementById('cloud-sync-button-text');
    if (label) label.textContent = state === 'synced' ? '已同步' : state === 'syncing' ? '同步中' : state === 'conflict' ? '有衝突' : '雲端';
    if (message) message.textContent = text;
    if (meta) meta.textContent = detail;
    if (alertButton) {
      const needsAttention = state === 'pending' || state === 'conflict' || state === 'error';
      alertButton.hidden = !needsAttention;
      alertButton.dataset.syncState = state;
      const shortText = state === 'conflict' ? 'Google Drive 有同步衝突' : state === 'error' ? 'Google Drive 同步失敗' : 'Google Drive 有未同步變更';
      if (alertText) alertText.textContent = shortText;
      alertButton.setAttribute('aria-label', `${shortText}，開啟同步設定`);
      document.querySelector('.workspace')?.classList.toggle('has-cloud-attention', needsAttention);
    }
    window.dispatchEvent(new CustomEvent('cloudsyncuichange', { detail:{ state, text, detail } }));
  }
  function formatTime(value) {
    if (!value) return '';
    try { return new Intl.DateTimeFormat('zh-TW', { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(value)); }
    catch { return new Date(value).toLocaleString(); }
  }
  function showSyncStateError(error, text = '無法讀取此瀏覽器的雲端同步狀態') {
    syncStateUnavailable = true;
    disconnect.disabled = true;
    action.disabled = false;
    action.textContent = '重試讀取同步狀態';
    if (resetSection) resetSection.hidden = false;
    setUi('error', text, '請稍後重試，或重新整理頁面。' + (error?.name ? `（${error.name}）` : ''));
  }
  async function readSyncState() {
    if (deviceResetRequested) return null;
    try {
      const state = await repository.getSyncState();
      syncStateUnavailable = false;
      disconnect.disabled = false;
      if (resetSection) resetSection.hidden = true;
      return state;
    } catch (error) {
      showSyncStateError(error);
      return null;
    }
  }
  async function refreshUiFromState() {
    const state = await readSyncState();
    if (!state) return false;
    syncConnected = Boolean(state.connected);
    disconnect.hidden = !state.connected;
    if (!clientId) {
      action.disabled = true;
      action.textContent = '目前未啟用雲端同步';
      setUi('unconfigured', '這個網站目前未啟用雲端同步', '可繼續在此裝置使用，並匯出族譜備份。');
      return true;
    }
    action.disabled = false;
    action.textContent = accessToken ? '立即同步' : state.connected ? '重新授權並同步' : '連結 Google Drive';
    if (accessToken && Date.now() < tokenExpiresAt && !state.dirty) setUi('synced', 'Google Drive 已同步', state.lastSyncedAt ? '上次同步：' + formatTime(state.lastSyncedAt) : '已連結 Google Drive appDataFolder。');
    else if (state.connected) setUi(state.dirty ? 'pending' : 'connected', state.dirty ? '此裝置有尚未同步的變更；下次操作時會嘗試恢復同步' : 'Google Drive 已連結；下次操作時會自動嘗試恢復同步', state.lastSyncedAt ? '上次同步：' + formatTime(state.lastSyncedAt) : '族譜仍安全保存在 IndexedDB。');
    else setUi('disconnected', '連結 Google Drive 以跨裝置同步', '族譜已儲存在此裝置。');
    return true;
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
    authResolve = null; authReject = null; authInFlight = null; authPurpose = null;
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
          if (deviceResetRequested) return;
          if (result.error || !result.access_token) {
            const error = new Error(result.error_description || result.error || 'Google 授權未完成。');
            completeAuthToast(false, error);
            finishAuthorization(null, error);
            return;
          }
          accessToken = result.access_token;
          tokenExpiresAt = Date.now() + Math.max(60, Number(result.expires_in) || 3600) * 1000;
          syncConnected = true;
          persistToken();
          repository.setSyncState({ connected: true }).catch(error => showSyncStateError(error, '無法儲存此瀏覽器的雲端連線狀態'));
          startPolling();
          completeAuthToast(true);
          finishAuthorization(accessToken);
        },
        error_callback: error => {
          const reason = error?.type === 'popup_closed' ? 'Google 驗證視窗已關閉，雲端連線尚未更新。' : error?.type === 'popup_failed_to_open' ? '瀏覽器阻擋了 Google 驗證視窗，請開啟雲端同步重試。' : 'Google Drive 雲端連線更新未完成。';
          const authError = new Error(reason);
          completeAuthToast(false, authError);
          finishAuthorization(null, authError);
        }
      });
      return tokenClient;
    })().finally(() => { tokenClientPromise = null; });
    return tokenClientPromise;
  }
  function requestTokenFromPreparedClient({ purpose = syncConnected ? 'refresh' : 'connect' } = {}) {
    if (!tokenClient) return null;
    if (authInFlight) return authInFlight;
    authPurpose = purpose;
    authInFlight = new Promise((resolve, reject) => { authResolve = resolve; authReject = reject; });
    const pending = authInFlight;
    showAuthToast('refreshing', authPurposeLabel(purpose));
    try {
      // Empty prompt reuses an existing Google grant/session when possible. The
      // request is intentionally issued directly from the user's click handler.
      tokenClient.requestAccessToken({ prompt: '' });
    } catch (error) {
      completeAuthToast(false, error);
      finishAuthorization(null, error);
    }
    return pending;
  }
  async function authorize() {
    if (!clientId) throw new Error('尚未設定 Google OAuth Client ID。');
    if (hasUsableToken()) return accessToken;
    await ensureTokenClient();
    return requestTokenFromPreparedClient({ purpose: syncConnected ? 'refresh' : 'connect' });
  }
  function prepareAuthorization() {
    if (deviceResetRequested || !clientId || !syncConnected || tokenClient) return;
    ensureTokenClient().catch(() => {});
  }
  function checkTokenRefreshAtStartup() {
    if (!clientId || !syncConnected) return false;
    const needsRefresh = tokenNeedsGestureRefresh();
    window.dispatchEvent(new CustomEvent('cloudauthstartupcheck', {
      detail:{ needsRefresh, hasToken:Boolean(accessToken), tokenExpiresAt }
    }));
    if (!needsRefresh) return false;
    prepareAuthorization();
    const text = accessToken
      ? 'Google Drive 雲端連線即將到期，將於下一次操作自動更新。'
      : 'Google Drive 雲端連線需要更新，將於下一次操作自動處理。';
    showAuthToast('waiting', text, 4600);
    return true;
  }
  function opportunisticAuthorizeFromGesture() {
    if (deviceResetRequested || syncStateUnavailable || !clientId || !tokenNeedsGestureRefresh()) return;
    // requestAccessToken must be called from the user-driven event. If GIS has
    // not finished preloading yet, prepare it now and use the next normal click.
    if (!tokenClient) { prepareAuthorization(); return; }
    const pending = requestTokenFromPreparedClient({ purpose: 'refresh' });
    if (!pending) return;
    pending
      .then(() => navigator.onLine ? syncNow({ interactive: false }) : null)
      .catch(() => refreshUiFromState().catch(() => {}));
  }
  const driveClient = FamilyGoogleDriveClient.create({
    fileName,
    getAccessToken: () => accessToken && Date.now() < tokenExpiresAt - 5_000 ? accessToken : null,
    validateData: data => FamilyModel.build(data),
    onUnauthorized: async () => {
      accessToken = null;
      tokenExpiresAt = 0;
      clearStoredToken();
      stopPolling();
      prepareAuthorization();
      await refreshUiFromState();
    }
  });
  function waitForConflictChoice(local, remote, remoteData) {
    if (!conflictDialog) return Promise.resolve('cloud');
    const relationCount = data => data.people.reduce((count, person) => count + (person.relationships?.length || 0), 0);
    document.getElementById('cloud-conflict-local-summary').textContent = `${local.data.people.length} 位成員\n${relationCount(local.data)} 筆關係記錄\n更新時間：未提供`;
    document.getElementById('cloud-conflict-remote-summary').textContent = `${remoteData.people.length} 位成員\n${relationCount(remoteData)} 筆關係記錄\n更新時間：${formatTime(remote.modifiedTime) || '未提供'}`;
    window.renderFamilyDifferences?.(document.getElementById('cloud-conflict-remote-summary').parentElement.parentElement, local.data, remoteData);
    chooseConflictVersion(null);
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
  let conflictChoice = null;
  function chooseConflictVersion(choice) {
    conflictChoice = choice;
    document.getElementById('cloud-conflict-use-local').setAttribute('aria-pressed', String(choice === 'local'));
    document.getElementById('cloud-conflict-use-remote').setAttribute('aria-pressed', String(choice === 'cloud'));
    const commit = document.getElementById('cloud-conflict-commit');
    commit.disabled = !choice;
    commit.textContent = choice === 'local' ? '保留此裝置，取代雲端' : choice === 'cloud' ? '使用雲端，取代此裝置' : '選擇要保留的版本';
  }
  document.getElementById('cloud-conflict-use-local')?.addEventListener('click', () => chooseConflictVersion('local'));
  document.getElementById('cloud-conflict-use-remote')?.addEventListener('click', () => chooseConflictVersion('cloud'));
  document.getElementById('cloud-conflict-commit')?.addEventListener('click', () => { if (conflictChoice) resolveConflict(conflictChoice); });
  document.getElementById('cloud-conflict-cancel')?.addEventListener('click', () => resolveConflict('cancel'));
  document.getElementById('close-cloud-conflict-dialog')?.addEventListener('click', () => resolveConflict('cancel'));
  conflictDialog?.addEventListener('cancel', event => { event.preventDefault(); resolveConflict('cancel'); });

  const syncEngine = FamilySyncEngine.create({
    repository,
    remote: driveClient,
    isOnline: () => navigator.onLine,
    onStatus: (state, text, detail = '') => setUi(state, text, detail),
    resolveConflict: ({ local, remote, remoteData }) => waitForConflictChoice(local, remote, remoteData)
  });
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
    return syncEngine.sync({ interactive });
  }
  async function syncNow({ interactive = true } = {}) {
    if (deviceResetRequested) return { outcome: 'cancelled' };
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
        const state = await readSyncState();
        if (state) setUi(state.dirty ? 'pending' : 'error', error.message || 'Google Drive 同步失敗。', '本次同步未完成，請稍後重試。');
        return { outcome: 'error', error };
      } finally {
        syncInFlight = null;
        await refreshActionOnly();
      }
    })();
    return syncInFlight;
  }
  async function refreshActionOnly() {
    const state = await readSyncState();
    if (!state) return;
    syncConnected = Boolean(state.connected);
    disconnect.hidden = !state.connected;
    if (syncConnected) prepareAuthorization();
    if (!clientId) return;
    action.disabled = false;
    action.textContent = accessToken ? '立即同步' : state.connected ? '重新授權並同步' : '連結 Google Drive';
  }
  function scheduleAutoSync() {
    if (deviceResetRequested || !accessToken) return;
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

  function stopForDeviceReset() {
    deviceResetRequested = true;
    accessToken = null;
    tokenExpiresAt = 0;
    syncConnected = false;
    clearStoredToken();
    clearTimeout(autoTimer);
    autoTimer = null;
    stopPolling();
    hideAuthToast();
    finishAuthorization(null, new Error('此裝置資料正在重置，已停止 Google 授權。'));
    driveClient.cancelPending();
    resolveConflict('cancel');
    action.disabled = true;
    disconnect.disabled = true;
  }
  window.addEventListener('familydevicereset', event => {
    if (event.detail?.phase === 'start') {
      stopForDeviceReset();
      setUi('resetting', '此裝置資料正在重置…');
    } else if (event.detail?.phase === 'complete') location.reload();
    else if (event.detail?.phase === 'failed') {
      setUi('error', '此裝置資料重置未完成', '可重試重置，或重新整理頁面後確認目前資料。');
      if (resetSection) resetSection.hidden = false;
    }
  });
  resetButton?.addEventListener('click', () => {
    resetStatus.textContent = '';
    resetError.textContent = '';
    resetDialog.showModal();
    resetCancel.focus();
  });
  resetCancel?.addEventListener('click', () => { if (!resetBusy) resetDialog.close(); });
  resetDialog?.addEventListener('cancel', event => { if (resetBusy) event.preventDefault(); });
  resetConfirm?.addEventListener('click', async () => {
    if (resetBusy) return;
    resetBusy = true;
    resetConfirm.disabled = resetCancel.disabled = true;
    resetStatus.textContent = '正在清除此裝置資料…';
    resetError.textContent = '';
    try {
      stopForDeviceReset();
      if (syncInFlight) await syncInFlight;
      await repository.resetDevice({ onBlocked: () => {
        resetStatus.textContent = '請關閉此瀏覽器中其他族譜分頁，讓重置繼續完成。';
      } });
    } catch (error) {
      resetStatus.textContent = '';
      resetError.textContent = '重置未完成：' + (error.message || '瀏覽器無法清除本機資料，請稍後重試。');
    } finally {
      resetBusy = false;
      resetConfirm.disabled = resetCancel.disabled = false;
    }
  });

  button.addEventListener('click', async () => {
    await refreshUiFromState();
    dialog.showModal();
    if (clientId) ensureTokenClient().catch(() => {});
  });
  alertButton?.addEventListener('click', () => button.click());
  document.getElementById('close-cloud-sync-dialog')?.addEventListener('click', () => dialog.close());
  dialog.addEventListener('cancel', () => {});
  action.addEventListener('click', async () => {
    if (syncStateUnavailable) { await refreshUiFromState(); return; }
    await syncNow({ interactive: true });
  });
  disconnect.addEventListener('click', async () => {
    accessToken = null;
    syncConnected = false;
    tokenExpiresAt = 0;
    clearStoredToken();
    stopPolling();
    hideAuthToast();
    try {
      await repository.setSyncState({ connected: false });
      setUi('disconnected', '已停止此裝置的 Google Drive 同步', '本程式不會刪除 Google Drive 上既有的 appDataFolder 資料；若要撤銷帳號授權，請至 Google 帳戶的第三方應用程式設定。');
      await refreshActionOnly();
    } catch (error) {
      showSyncStateError(error, '無法儲存此瀏覽器的中斷連結狀態');
    }
  });

  window.addEventListener('familyrepositorychange', event => {
    if (['local', 'geocode'].includes(event.detail?.source) || event.detail?.kinshipEnriched) scheduleAutoSync();
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
      if (!await refreshUiFromState()) return;
      if (syncConnected) {
        prepareAuthorization();
        checkTokenRefreshAtStartup();
      }
      if (restoredSessionToken) {
        startPolling();
        if (navigator.onLine) syncNow({ interactive: false });
      }
    } catch (error) {
      setUi('error', error.message || '無法讀取同步狀態。');
    }
  })();
  window.FamilyGoogleDriveSync = { syncNow, prepareAuthorization, checkTokenRefreshAtStartup };
})();
