/* One persistence boundary: development API or browser-only static deployment. */
(function () {
  'use strict';
  const isStatic = document.querySelector('meta[name="family-storage-mode"]')?.content === 'browser';
  const base = new URL('./', location.href);
  const key = 'family-static-v1:' + base.pathname;
  const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  function read() {
    const text = localStorage.getItem(key);
    if (!text) return { data: { schemaVersion: 2, familyName: '我的家族', people: [] }, version: 'empty' };
    const saved = JSON.parse(text);
    FamilyModel.build(saved.data);
    if (typeof saved.version !== 'string') throw new Error('瀏覽器族譜資料格式不正確。');
    return saved;
  }
  function persist(data) {
    FamilyModel.build(data);
    const saved = { data, version: crypto.randomUUID() };
    try { localStorage.setItem(key, JSON.stringify(saved)); }
    catch { throw new Error('瀏覽器儲存空間不足或不允許儲存，本次變更尚未儲存。'); }
    return saved;
  }
  function localRequest(url, options) {
    const current = read(), method = options.method || 'GET';
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
    if (body.version !== current.version) return response({ error: '資料已在其他分頁更新，請更新資料後再儲存。' }, 409);
    let data;
    if (adding) data = { ...current.data, people: [...current.data.people, member] };
    else if (memberId) data = FamilyModel.replaceMember(current.data, member);
    else if (url === '/api/family/name') data = { ...current.data, familyName: FamilyModel.normalizeFamilyName(body.familyName) };
    else if (url === '/api/family/import') {
      FamilyModel.build(body.data);
      try { localStorage.setItem(key + ':before-import', JSON.stringify(current)); }
      catch { throw new Error('無法保留匯入前的備份，尚未匯入。請先匯出目前資料並清理瀏覽器空間。'); }
      data = body.data;
    } else return response({ error: '不支援的操作。' }, 404);
    return response({ ...persist(data), ...(member ? { memberId: member.id } : {}), ...(url.endsWith('/import') ? { backupCreated: true } : {}) });
  }
  async function request(url, options = {}) {
    if (!isStatic) return fetch(url, options);
    try {
      // Web Locks serializes read/check/write across tabs on the same site.
      if ((options.method || 'GET') !== 'GET' && navigator.locks) return await navigator.locks.request(key, () => localRequest(url, options));
      return localRequest(url, options);
    } catch (error) { return response({ error: error.message || '無法存取瀏覽器族譜資料。' }, 400); }
  }
  window.FamilyRepository = { isStatic, request };
})();
