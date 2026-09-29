/* Local-first family synchronization policy. No OAuth, DOM, timers, or Drive REST details live here. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FamilySyncEngine = api;
})(globalThis, function () {
  'use strict';

  function create({ repository, remote, isOnline = () => true, onStatus = () => {}, resolveConflict = async () => 'cancel' }) {
    async function handleConflict(local, remoteMeta, interactive) {
      onStatus('conflict', '此裝置與 Google Drive 都有不同的族譜版本', '請選擇要保留哪一份資料。');
      if (!interactive) return { outcome: 'conflict' };
      const remoteData = await remote.download(remoteMeta);
      const choice = await resolveConflict({ local, remote: remoteMeta, remoteData });
      if (choice === 'cancel') return { outcome: 'cancelled' };

      const latestLocal = await repository.read();
      const latestRemote = await remote.find();
      if (latestLocal.version !== local.version || !latestRemote || latestRemote.id !== remoteMeta.id || latestRemote.version !== remoteMeta.version) {
        throw new Error('預覽期間資料已更新，請重新同步並檢查最新差異。');
      }
      if (choice === 'local') {
        onStatus('syncing', '正在以此裝置資料更新 Google Drive…');
        const uploaded = await remote.update(remoteMeta.id, local.data);
        await repository.markCloudSynced({ fileId: uploaded.id, remoteVersion: uploaded.version }, local.version);
        return { outcome: 'uploaded', remote: uploaded };
      }
      onStatus('syncing', '正在從 Google Drive 載入族譜…');
      await repository.replaceFromCloud(remoteData, { fileId: remoteMeta.id, remoteVersion: remoteMeta.version }, local.version);
      return { outcome: 'downloaded', remote: remoteMeta };
    }

    async function sync({ interactive = true } = {}) {
      if (!isOnline()) throw new Error('目前離線；資料已保存在 IndexedDB，恢復網路後再同步。');
      onStatus('syncing', '正在檢查 Google Drive…');
      const [local, state, remoteMeta] = await Promise.all([repository.read(), repository.getSyncState(), remote.find()]);

      if (!remoteMeta) {
        onStatus('syncing', '正在建立 Google Drive 雲端族譜…');
        const created = await remote.create(local.data);
        await repository.markCloudSynced({ fileId: created.id, remoteVersion: created.version }, local.version);
        return { outcome: 'created', remote: created };
      }

      const sameFile = state.fileId === remoteMeta.id;
      const knowsRemoteVersion = sameFile && typeof state.remoteVersion === 'string' && state.remoteVersion.length > 0;
      if (!knowsRemoteVersion) {
        if (repository.isPristine(local.data) && !state.dirty) {
          onStatus('syncing', '正在從 Google Drive 載入族譜…');
          const data = await remote.download(remoteMeta);
          await repository.replaceFromCloud(data, { fileId: remoteMeta.id, remoteVersion: remoteMeta.version }, local.version);
          return { outcome: 'downloaded', remote: remoteMeta };
        }
        return handleConflict(local, remoteMeta, interactive);
      }

      if (remoteMeta.version !== state.remoteVersion) {
        if (state.dirty) return handleConflict(local, remoteMeta, interactive);
        onStatus('syncing', 'Google Drive 有較新資料，正在下載…');
        const data = await remote.download(remoteMeta);
        await repository.replaceFromCloud(data, { fileId: remoteMeta.id, remoteVersion: remoteMeta.version }, local.version);
        return { outcome: 'downloaded', remote: remoteMeta };
      }

      if (state.dirty) {
        onStatus('syncing', '正在將此裝置的變更上傳至 Google Drive…');
        const uploaded = await remote.update(remoteMeta.id, local.data);
        await repository.markCloudSynced({ fileId: uploaded.id, remoteVersion: uploaded.version }, local.version);
        return { outcome: 'uploaded', remote: uploaded };
      }

      await repository.markCloudSynced({ fileId: remoteMeta.id, remoteVersion: remoteMeta.version }, local.version);
      return { outcome: 'unchanged', remote: remoteMeta };
    }

    return { sync };
  }

  return { create };
});
