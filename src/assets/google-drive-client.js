/* Google Drive appDataFolder transport. Authentication and sync policy are supplied by callers. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FamilyGoogleDriveClient = api;
})(globalThis, function () {
  'use strict';
  const DRIVE_BASE = 'https://www.googleapis.com/drive/v3/files';
  const UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3/files';

  function create({ getAccessToken, onUnauthorized, validateData, fileName = 'family-tree.json' }) {
    async function driveFetch(url, options = {}) {
      const token = getAccessToken?.();
      if (!token) throw new Error('Google 授權已過期；請在下一次操作時允許恢復同步，或開啟雲端面板重新授權。');
      const response = await fetch(url, {
        ...options,
        headers: { ...(options.headers || {}), Authorization: 'Bearer ' + token }
      });
      if (response.status === 401) {
        await onUnauthorized?.();
        throw new Error('Google 授權已過期；下次操作時會自動嘗試恢復同步。');
      }
      if (!response.ok) {
        let detail = '';
        try { detail = (await response.json())?.error?.message || ''; } catch {}
        throw new Error(detail || `Google Drive API 發生錯誤（${response.status}）。`);
      }
      return response;
    }

    async function find() {
      const query = `'appDataFolder' in parents and name = '${fileName.replaceAll("'", "\\'")}' and trashed = false`;
      const params = new URLSearchParams({
        spaces: 'appDataFolder',
        q: query,
        orderBy: 'modifiedTime desc',
        pageSize: '10',
        fields: 'files(id,name,version,modifiedTime,size)'
      });
      const payload = await (await driveFetch(DRIVE_BASE + '?' + params)).json();
      return payload.files?.[0] || null;
    }

    function multipartBody(metadata, data) {
      const boundary = 'family_tree_' + crypto.randomUUID().replaceAll('-', '');
      const body = new Blob([
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
        JSON.stringify(metadata),
        `\r\n--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
        JSON.stringify(data, null, 2),
        `\r\n--${boundary}--`
      ]);
      return { body, contentType: `multipart/related; boundary=${boundary}` };
    }

    async function createRemote(data) {
      const multipart = multipartBody({ name: fileName, mimeType: 'application/json', parents: ['appDataFolder'] }, data);
      const params = new URLSearchParams({ uploadType: 'multipart', fields: 'id,name,version,modifiedTime,size' });
      return (await (await driveFetch(UPLOAD_BASE + '?' + params, {
        method: 'POST',
        headers: { 'Content-Type': multipart.contentType },
        body: multipart.body
      })).json());
    }

    async function update(fileId, data) {
      const params = new URLSearchParams({ uploadType: 'media', fields: 'id,name,version,modifiedTime,size' });
      return (await (await driveFetch(`${UPLOAD_BASE}/${encodeURIComponent(fileId)}?${params}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json; charset=UTF-8' },
        body: JSON.stringify(data, null, 2)
      })).json());
    }

    async function download(remote) {
      const response = await driveFetch(`${DRIVE_BASE}/${encodeURIComponent(remote.id)}?alt=media`);
      let data;
      try { data = JSON.parse((await response.text()).replace(/^\uFEFF/, '')); }
      catch { throw new Error('Google Drive 上的族譜檔案不是有效的 JSON。'); }
      validateData?.(data);
      return data;
    }

    return { find, create: createRemote, update, download };
  }

  return { create };
});
