(function () {
  'use strict';
  const dialog = document.getElementById('member-dialog');
  const form = document.getElementById('member-form');
  const relations = document.getElementById('member-relations');
  const error = document.getElementById('member-error');
  const status = document.getElementById('save-status');
  const addButton = document.getElementById('add-member');
  const labels = { parent: '父母', child: '子女', spouse: '配偶', sibling: '手足', swornSibling: '契手足', teacher: '師父', student: '徒弟' };
  let snapshot = null, requestId = null, saving = false, editingId = null;
  function option(value, text) { const el = document.createElement('option'); el.value = value; el.textContent = text; return el; }
  function updateTargets(select) {
    const previous = select.value;
    select.replaceChildren(option('', '選擇現有成員'));
    snapshot.data.people.filter(p => p.id !== editingId).forEach(p => select.appendChild(option(p.id, p.name + (p.location ? ' · ' + p.location : ''))));
    select.value = [...select.options].some(o => o.value === previous) ? previous : '';
  }
  function accept(payload) {
    const graph = FamilyModel.build(payload.data);
    snapshot = payload;
    window.FAMILY = graph;
    window.renderFamilyTree();
    addButton.disabled = false;
    document.getElementById('import-json').disabled = false;
    document.getElementById('export-json').disabled = false;
  }
  async function load() {
    const response = await fetch('/api/family', { cache: 'no-store' });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || '無法載入族譜。');
    accept(payload);
  }
  function addRelation(initial = null) {
    const row = document.createElement('div'); row.className = 'relation-row';
    function field(title, className) {
      const label = document.createElement('label'); label.textContent = title;
      const select = document.createElement('select'); select.className = className; select.required = true;
      label.appendChild(select); row.appendChild(label); return select;
    }
    const target = field('現有成員', 'relation-target'); updateTargets(target);
    const type = field('是這位成員的', 'relation-type'); type.appendChild(option('', '選擇關係'));
    Object.entries(labels).forEach(([value, text]) => type.appendChild(option(value, text)));
    const kind = field('親子類型', 'relation-kind'); FamilyModel.KINDS.forEach(value => kind.appendChild(option(value, value)));
    kind.parentElement.className = 'relation-kind-field';
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'plain-button remove-relation'; remove.textContent = '移除';
    remove.addEventListener('click', () => row.remove()); row.appendChild(remove);
    const preview = document.createElement('p'); preview.className = 'relation-preview'; row.appendChild(preview);
    function update() {
      const isParent = ['parent', 'child'].includes(type.value);
      kind.parentElement.hidden = !isParent; kind.disabled = !isParent;
      const name = snapshot.data.people.find(p => p.id === target.value)?.name;
      preview.textContent = name && type.value ? `${name}是${document.getElementById('member-name').value.trim() || '這位成員'}的${labels[type.value]}${isParent ? '（' + kind.value + '）' : ''}` : '請選擇對象與關係。';
    }
    row.addEventListener('change', update);
    row.updatePreview = update;
    if (initial) { target.value = initial.personId; type.value = initial.type; if (initial.kind) kind.value = initial.kind; }
    relations.appendChild(row); update(); if (!initial) target.focus();
  }
  function setSaving(value) {
    saving = value;
    document.getElementById('member-fields').disabled = value;
    ['save-member', 'refresh-family', 'cancel-member', 'close-member-dialog'].forEach(id => document.getElementById(id).disabled = value);
    document.getElementById('save-member').textContent = value ? '儲存中…' : editingId ? '儲存修改' : '儲存成員';
  }
  function populateMember() {
    const person = snapshot.data.people.find(p => p.id === editingId);
    if (!person) throw new Error('此成員已不存在，請關閉表單後更新資料。');
    for (const key of ['name', 'location', 'position', 'gender', 'siblingOrder']) form.elements.namedItem(key).value = person[key] ?? '';
    relations.replaceChildren();
    FamilyModel.relationshipsFor(snapshot.data, editingId).forEach(addRelation);
  }
  function openMember(id = null) {
    editingId = id;
    form.reset(); relations.replaceChildren(); error.textContent = ''; status.textContent = ''; requestId = crypto.randomUUID();
    document.getElementById('member-dialog-title').textContent = editingId ? '編輯成員與關係' : '新增成員';
    document.getElementById('refresh-family').textContent = editingId ? '重新載入成員' : '更新資料';
    if (editingId) populateMember();
    setSaving(false);
    dialog.showModal(); document.getElementById('member-name').focus();
  }
  addButton.addEventListener('click', () => openMember());
  window.editFamilyMember = openMember;
  ['close-member-dialog', 'cancel-member'].forEach(id => document.getElementById(id).addEventListener('click', () => dialog.close()));
  dialog.addEventListener('cancel', event => { if (saving) event.preventDefault(); });
  document.getElementById('add-relation').addEventListener('click', () => addRelation());
  document.getElementById('member-name').addEventListener('input', () => [...relations.children].forEach(row => row.updatePreview()));
  document.getElementById('refresh-family').addEventListener('click', async () => {
    error.textContent = '';
    try {
      await load();
      if (editingId) { populateMember(); error.textContent = '已載入此成員的最新資料，請重新套用修改。'; }
      else { relations.querySelectorAll('.relation-target').forEach(updateTargets); [...relations.children].forEach(row => row.updatePreview()); status.textContent = '已更新資料，表單內容已保留。'; }
    }
    catch (e) { error.textContent = e.message; }
  });
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (saving || !form.reportValidity()) return;
    error.textContent = '';
    const values = new FormData(form);
    const member = {
      name: values.get('name').trim(), location: values.get('location').trim(), position: values.get('position').trim(), gender: values.get('gender'),
      siblingOrder: values.get('siblingOrder') === '' ? null : Number(values.get('siblingOrder')),
      relationships: [...relations.children].map(row => {
        const type = row.querySelector('.relation-type').value;
        const r = { type, personId: row.querySelector('.relation-target').value };
        if (['parent', 'child'].includes(type)) r.kind = row.querySelector('.relation-kind').value;
        return r;
      })
    };
    setSaving(true);
    try {
      const response = await fetch(editingId ? '/api/members/' + encodeURIComponent(editingId) : '/api/members', { method: editingId ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ member, requestId, version: snapshot.version }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || '儲存失敗，請重試。');
      document.getElementById('family-filter').value = '';
      accept(payload); dialog.close();
      window.selectFamilyMember(payload.memberId);
      status.textContent = `已${editingId ? '更新' : '新增'}「${member.name}」，並儲存至族譜檔案。`;
    } catch (e) { error.textContent = e.message || '連線中斷，請重試。'; }
    finally { setSaving(false); }
  });
  const importDialog = document.getElementById('import-dialog');
  const importFile = document.getElementById('import-file');
  const importError = document.getElementById('import-error');
  let stagedImport = null, importVersion = null, importing = false;
  function importSummary() {
    document.getElementById('import-summary').textContent = `檔案：${stagedImport.name}。將以 ${stagedImport.data.people.length} 位成員取代目前的 ${snapshot.data.people.length} 位成員。`;
  }
  document.getElementById('import-json').addEventListener('click', () => { importFile.value = ''; importFile.click(); });
  importFile.addEventListener('change', async () => {
    const file = importFile.files[0]; if (!file) return;
    stagedImport = null; status.textContent = ''; importError.textContent = '';
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error('JSON 檔案不能超過 5 MB。');
      let data;
      try { data = JSON.parse((await file.text()).replace(/^\uFEFF/, '')); } catch { throw new Error('檔案不是有效的 JSON，請檢查內容後重新選擇。'); }
      FamilyModel.build(data);
      stagedImport = { data, name: file.name }; importVersion = snapshot.version;
      importSummary(); importDialog.showModal();
    } catch (e) { status.textContent = '無法匯入：' + e.message; }
  });
  document.getElementById('cancel-import').addEventListener('click', () => { stagedImport = null; importDialog.close(); });
  importDialog.addEventListener('cancel', event => { if (importing) event.preventDefault(); else stagedImport = null; });
  document.getElementById('refresh-import').addEventListener('click', async () => {
    try { await load(); importVersion = snapshot.version; importSummary(); importError.textContent = '已更新目前資料，請確認取代範圍後再匯入。'; }
    catch (e) { importError.textContent = e.message; }
  });
  document.getElementById('confirm-import').addEventListener('click', async () => {
    if (importing || !stagedImport) return;
    importing = true; importError.textContent = '';
    ['confirm-import', 'cancel-import', 'refresh-import'].forEach(id => document.getElementById(id).disabled = true);
    try {
      const response = await fetch('/api/family/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: stagedImport.data, version: importVersion }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || '匯入失敗，請重試。');
      document.getElementById('family-filter').value = '';
      delete document.querySelector('.tree').dataset.scope;
      accept(payload); window.selectFamilyMember(null);
      importDialog.close(); stagedImport = null;
      status.textContent = `已匯入 ${payload.data.people.length} 位成員，並保留匯入前的資料備份。`;
    } catch (e) { importError.textContent = e.message; }
    finally { importing = false; ['confirm-import', 'cancel-import', 'refresh-import'].forEach(id => document.getElementById(id).disabled = false); }
  });
  document.getElementById('export-json').addEventListener('click', async () => {
    const button = document.getElementById('export-json'); button.disabled = true;
    try {
      // Export the latest persisted JSON, including changes from other open pages.
      const response = await fetch('/api/family/export', { cache: 'no-store' });
      if (!response.ok) throw new Error((await response.json()).error || '匯出失敗。');
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a'); link.href = url; link.download = 'family.json';
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      status.textContent = '已匯出目前儲存的族譜資料。';
    } catch (e) { status.textContent = '無法匯出：' + e.message; }
    finally { button.disabled = false; }
  });
  load().catch(e => {
    const canvas = document.getElementById('tree-canvas');
    canvas.replaceChildren();
    const message = document.createElement('p'); message.className = 'tree__error';
    message.textContent = location.protocol === 'file:' ? '請先執行 node server.cjs，再開啟 http://127.0.0.1:4173，才能讀取與儲存族譜。' : e.message;
    canvas.appendChild(message);
  });
})();
