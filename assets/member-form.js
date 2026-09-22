(function () {
  'use strict';
  const dialog = document.getElementById('member-dialog');
  const form = document.getElementById('member-form');
  const relations = document.getElementById('member-relations');
  const error = document.getElementById('member-error');
  const status = document.getElementById('save-status');
  const backupStatus = document.getElementById('backup-status');
  // Backup information is secondary and may quietly disappear. Action feedback uses
  // showStatus() below so success toasts are short-lived while errors stay visible.
  {
    let timer;
    const refresh = () => {
      clearTimeout(timer);
      backupStatus.hidden = !backupStatus.textContent.trim();
      if (!backupStatus.hidden) timer = setTimeout(() => { backupStatus.hidden = true; }, 10000);
    };
    new MutationObserver(refresh).observe(backupStatus, { childList: true, characterData: true, subtree: true });
    refresh();
  }
  let statusTimer;
  function showStatus(message, kind = 'success', timeout, action = null) {
    clearTimeout(statusTimer);
    status.replaceChildren();
    status.dataset.kind = kind;
    status.hidden = !message;
    if (!message) return;
    const text = document.createElement('span'); text.className = 'save-status__message'; text.textContent = message;
    status.appendChild(text);
    if (action?.label && typeof action.onClick === 'function') {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'save-status__action'; button.textContent = action.label;
      button.addEventListener('click', async () => {
        clearTimeout(statusTimer); button.disabled = true;
        try { await action.onClick(); } finally { if (button.isConnected) button.disabled = false; }
      });
      status.appendChild(button);
    }
    const duration = timeout === undefined ? (kind === 'error' || kind === 'warning' ? 0 : action ? 6000 : 3000) : timeout;
    if (duration > 0) statusTimer = setTimeout(() => { status.hidden = true; }, duration);
  }
  const backup = FamilyStorage.create(window, FamilyModel.build);
  let restoredBackup = false;
  const addButton = document.getElementById('add-member');
  const familyTitle = document.getElementById('family-title');
  const familyNameButton = document.getElementById('edit-family-name');
  const nameDialog = document.getElementById('family-name-dialog');
  const nameForm = document.getElementById('family-name-form');
  const nameInput = document.getElementById('family-name-input');
  const nameError = document.getElementById('family-name-error');
  const ignoredDialog = document.getElementById('ignored-intermediate-dialog');
  const ignoredList = document.getElementById('ignored-intermediate-list');
  const ignoredEmpty = document.getElementById('ignored-intermediate-empty');
  const ignoredError = document.getElementById('ignored-intermediate-error');
  const unsavedDialog = document.getElementById('unsaved-changes-dialog');
  const keepEditingButton = document.getElementById('keep-editing-member');
  const discardChangesButton = document.getElementById('discard-member-changes');
  const draftDialog = document.getElementById('member-draft-dialog');
  const draftMessage = document.getElementById('member-draft-message');
  const resumeDraftButton = document.getElementById('resume-member-draft');
  const discardDraftButton = document.getElementById('discard-member-draft');
  const MEMBER_DRAFT_KEY = 'family-tree:member-form-draft:v1';
  let memberBaseline = '', pendingMemberClose = null, currentPlanId = null, pendingDraft = null, draftTimer = null;
  let nameVersion = null, savingName = false;
  const labels = { parent: '父母', child: '子女', grandparent: '祖父母（跨一代）', grandchild: '孫子女（跨一代）', spouse: '配偶', sibling: '手足', swornSibling: '契手足', tangCousin: '堂兄弟姊妹（直接設定）', biaoCousin: '表兄弟姊妹（直接設定）', fellowDisciple: '師兄弟姊妹', teacher: '師父', student: '徒弟' };
  let snapshot = null, requestId = null, saving = false, editingId = null;
  function option(value, text) { const el = document.createElement('option'); el.value = value; el.textContent = text; return el; }
  function memberFormSnapshot() {
    const field = name => String(form.elements.namedItem(name)?.value ?? '');
    return {
      fields: {
        name: field('name'), location: field('location'), position: field('position'), notes: field('notes'),
        gender: field('gender'), siblingOrder: field('siblingOrder'), discipleOrder: field('discipleOrder')
      },
      intermediateChoice: document.getElementById('intermediate-choice')?.value || '',
      relationships: [...relations.children].map(row => ({
        target: row.querySelector('.relation-target')?.value || '',
        type: row.querySelector('.relation-type')?.value || '',
        kind: row.querySelector('.relation-kind')?.value || '',
        seniority: row.querySelector('.relation-cousin-seniority')?.value || '',
        note: row.querySelector('.relation-note')?.value || '', source: row.querySelector('.relation-source')?.value || '',
        status: row.querySelector('.relation-status')?.value || 'confirmed', groupId: row.querySelector('.relation-group')?.value || ''
      }))
    };
  }
  function memberFormState() { return JSON.stringify(memberFormSnapshot()); }
  function resetMemberBaseline() { memberBaseline = memberFormState(); }
  function memberFormDirty() { return dialog.open && memberBaseline !== memberFormState(); }
  function draftContext() { return editingId ? 'edit:' + editingId : currentPlanId ? 'plan:' + currentPlanId : 'new'; }
  function readMemberDraft() {
    try { return JSON.parse(sessionStorage.getItem(MEMBER_DRAFT_KEY) || 'null'); } catch (_) { return null; }
  }
  function clearMemberDraft() {
    clearTimeout(draftTimer);
    const draft = readMemberDraft();
    try { if (!draft || draft.context === draftContext()) sessionStorage.removeItem(MEMBER_DRAFT_KEY); } catch (_) {}
    pendingDraft = null;
  }
  function persistMemberDraft() {
    clearTimeout(draftTimer);
    if (!dialog.open || saving || !memberFormDirty()) {
      const draft = readMemberDraft();
      try { if (draft?.context === draftContext()) sessionStorage.removeItem(MEMBER_DRAFT_KEY); } catch (_) {}
      return;
    }
    try {
      sessionStorage.setItem(MEMBER_DRAFT_KEY, JSON.stringify({
        version: 1, context: draftContext(), savedAt: Date.now(), state: memberFormSnapshot()
      }));
    } catch (_) {}
  }
  function scheduleMemberDraft() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(persistMemberDraft, 180);
  }
  function restoreMemberDraft(draft) {
    if (!draft?.state) return;
    const state = draft.state;
    Object.entries(state.fields || {}).forEach(([name, value]) => {
      const control = form.elements.namedItem(name);
      if (control) control.value = value ?? '';
    });
    const choice = document.getElementById('intermediate-choice');
    if (choice && state.intermediateChoice && [...choice.options].some(option => option.value === state.intermediateChoice)) choice.value = state.intermediateChoice;
    relations.replaceChildren();
    (state.relationships || []).forEach(relation => addRelation({
      personId: relation.target, type: relation.type, kind: relation.kind, seniority: relation.seniority,
      note: relation.note, source: relation.source, status: relation.status, groupId: relation.groupId
    }, { expanded: false }));
    [...relations.children].forEach(row => row.updatePreview?.());
    scheduleMemberDraft();
  }
  function offerMemberDraft() {
    const draft = readMemberDraft();
    if (!draft || draft.context !== draftContext() || JSON.stringify(draft.state) === memberBaseline) return;
    pendingDraft = draft;
    const minutes = Math.max(0, Math.round((Date.now() - Number(draft.savedAt || Date.now())) / 60000));
    draftMessage.textContent = `找到${minutes ? `約 ${minutes} 分鐘前` : '剛才'}尚未完成的${editingId ? '成員修改' : '新增成員資料'}。`;
    draftDialog.showModal();
    resumeDraftButton.focus();
  }
  function closeMemberNow(clearDraft = false) {
    pendingMemberClose = null;
    if (clearDraft) clearMemberDraft();
    if (unsavedDialog?.open) unsavedDialog.close();
    if (draftDialog?.open) draftDialog.close();
    dialog.close();
  }
  function requestMemberClose() {
    if (saving) return;
    if (!memberFormDirty()) { closeMemberNow(); return; }
    pendingMemberClose = true;
    if (!unsavedDialog.open) unsavedDialog.showModal();
    keepEditingButton.focus();
  }
  function updateTargets(select) {
    const previous = select.value;
    select.replaceChildren(option('', '選擇現有成員'));
    const names = FamilyModel.memberOptionLabels(snapshot.data.people);
    snapshot.data.people.filter(p => p.id !== editingId).forEach(p => select.appendChild(option(p.id, names.get(p.id))));
    select.value = [...select.options].some(o => o.value === previous) ? previous : '';
  }
  function accept(payload, restored = false) {
    const graph = FamilyModel.build(payload.data);
    snapshot = payload;
    restoredBackup = restored;
    const storage = FamilyRepository.isStatic ? 'IndexedDB' : restored ? null : backup.save(payload);
    backupStatus.textContent = FamilyRepository.isStatic ? '已儲存至此瀏覽器（IndexedDB）；可連結 Google Drive 跨裝置同步，JSON 匯出仍可作為離線備份。' : restored ? '已還原瀏覽器備份，可檢視及匯出；重新連線並重新整理後可繼續編輯。' : storage ? `已自動備份至瀏覽器（${storage === 'cookie' ? 'Cookie' : 'localStorage'}）` : '瀏覽器備份失敗；資料仍已儲存至伺服器，請匯出備份。';
    const familyName = graph.familyName;
    familyTitle.textContent = familyName + '族譜圖';
    document.title = '族譜圖 — ' + familyName;
    familyNameButton.disabled = restored;
    window.FAMILY = graph;
    window.renderFamilyTree();
    addButton.disabled = restored;
    document.getElementById('import-json').disabled = restored;
    document.getElementById('export-json').disabled = false;
    if (ignoredDialog?.open) renderIgnoredIntermediatePlans();
    window.dispatchEvent(new CustomEvent('familyintermediatechange'));
  }
  async function load() {
    const response = await FamilyRepository.request('/api/family', { cache: 'no-store' });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || '無法載入族譜。');
    accept(payload);
  }
  async function undoLastChange(expectedVersion) {
    const response = await FamilyRepository.request('/api/family/undo', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: expectedVersion })
    });
    const payload = await response.json();
    if (!response.ok) { showStatus(payload.error || '無法復原上一項修改。', 'error'); return false; }
    document.getElementById('family-filter').value = '';
    delete document.querySelector('.tree').dataset.scope;
    window.clearFamilyViewState?.();
    accept(payload);
    window.selectFamilyMember(null);
    showStatus(`已復原「${payload.undoneLabel || '上一項修改'}」。`, 'info');
    return true;
  }
  function showUndoStatus(message, payload) {
    showStatus(message, 'success', 6000, { label: '復原', onClick: () => undoLastChange(payload.version) });
  }
  function addRelation(initial = null, { expanded = initial == null } = {}) {
    const row = document.createElement('div'); row.className = 'relation-row';
    const header = document.createElement('div'); header.className = 'relation-row__header';
    const summary = document.createElement('div'); summary.className = 'relation-row__summary';
    const summaryTitle = document.createElement('strong'); summaryTitle.className = 'relation-row__summary-title';
    const summaryHint = document.createElement('span'); summaryHint.className = 'relation-row__summary-hint';
    summary.append(summaryTitle, summaryHint);
    function relationAction(label, className, path) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'plain-button relation-row__action ' + className;
      button.setAttribute('aria-label', label); button.title = label;
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor');
      svg.setAttribute('stroke-width', '1.8'); svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round');
      svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
      const shape = document.createElementNS('http://www.w3.org/2000/svg', 'path'); shape.setAttribute('d', path); svg.appendChild(shape);
      const text = document.createElement('span'); text.className = 'relation-row__action-label'; text.textContent = label;
      button.append(svg, text); return { button, shape, text };
    }
    const actions = document.createElement('div'); actions.className = 'relation-row__actions';
    const toggleAction = relationAction('編輯', 'relation-row__toggle', 'M12 20h9 M16.5 3.5a2.12 2.12 0 0 1 3 3L9 17l-4 1 1-4L16.5 3.5z');
    const toggle = toggleAction.button;
    const removeAction = relationAction('移除', 'remove-relation', 'M4 7h16 M9 7V4h6v3 M7 7l1 13h8l1-13 M10 11v5 M14 11v5');
    const remove = removeAction.button;
    const editor = document.createElement('div'); editor.className = 'relation-row__editor';
    actions.append(toggle, remove); header.append(summary, actions); row.append(header, editor);
    function setExpanded(value, { focus = false } = {}) {
      row.dataset.expanded = String(Boolean(value));
      editor.hidden = !value;
      const label = value ? '收合' : '編輯';
      toggleAction.text.textContent = label;
      toggleAction.shape.setAttribute('d', value ? 'M6 15l6-6 6 6' : 'M12 20h9 M16.5 3.5a2.12 2.12 0 0 1 3 3L9 17l-4 1 1-4L16.5 3.5z');
      toggle.setAttribute('aria-label', label + '此關係'); toggle.title = label + '此關係';
      toggle.setAttribute('aria-expanded', String(Boolean(value)));
      if (focus && value) editor.querySelector('select,button,input')?.focus();
    }
    toggle.addEventListener('click', () => setExpanded(row.dataset.expanded !== 'true', { focus: row.dataset.expanded !== 'true' }));
    function field(title, className) {
      const label = document.createElement('label'); label.textContent = title;
      const select = document.createElement('select'); select.className = className; select.required = true;
      label.appendChild(select); editor.appendChild(label); return select;
    }
    const target = field('現有成員', 'relation-target'); updateTargets(target);
    const type = field('是這位成員的', 'relation-type'); type.appendChild(option('', '選擇關係'));
    Object.entries(labels).forEach(([value, text]) => type.appendChild(option(value, text)));
    const kind = field('親子／祖孫類型', 'relation-kind'); FamilyModel.KINDS.forEach(value => kind.appendChild(option(value, value)));
    kind.parentElement.className = 'relation-kind-field';
    const seniority = field('對方的長幼', 'relation-cousin-seniority'); seniority.parentElement.className = 'relation-cousin-field';
    seniority.append(option('unknown', '未確認'), option('older', '對方比此成員年長'), option('younger', '對方比此成員年幼'));
    const rankGroup = field('使用的排行群組', 'relation-group'); rankGroup.required = false;
    const state = field('確認狀態', 'relation-status'); state.append(option('confirmed', '已確認'), option('pending', '待確認'));
    const textField = (title, className) => {
      const label = document.createElement('label'); label.textContent = title; label.className = 'relation-metadata';
      const input = document.createElement('textarea'); input.className = className; input.rows = 2; input.maxLength = 2000;
      label.append(input); editor.append(label); return input;
    };
    const source = textField('關係來源（選填）', 'relation-source');
    const note = textField('關係說明（選填）', 'relation-note');
    remove.addEventListener('click', () => { row.remove(); scheduleMemberDraft(); });
    const preview = document.createElement('p'); preview.className = 'relation-preview'; editor.appendChild(preview);
    function update() {
      const isParent = FamilyModel.isDescent(type.value);
      kind.closest('label').hidden = !isParent; kind.disabled = !isParent;
      seniority.closest('label').hidden = !FamilyModel.hasSeniority(type.value); seniority.disabled = !FamilyModel.hasSeniority(type.value);
      const person = snapshot.data.people.find(p => p.id === target.value);
      const base = { id: editingId || 'p-' + requestId, name: document.getElementById('member-name').value.trim() || '這位成員', gender: form.elements.namedItem('gender').value,
        siblingOrder: Number(form.elements.namedItem('siblingOrder').value) || null, discipleOrder: Number(form.elements.namedItem('discipleOrder').value) || null };
      const selectedGroup = rankGroup.value || initial?.groupId || '';
      const availableGroups = (snapshot.data.rankGroups || []).filter(g => g.type === type.value && g.members.some(m => m.personId === target.value) && g.members.some(m => m.personId === base.id));
      const groupSignature = JSON.stringify(availableGroups.map(g => [g.id, g.name]));
      if (rankGroup.dataset.signature !== groupSignature) {
        rankGroup.replaceChildren(option('', '自動判定／未指定')); availableGroups.forEach(g => rankGroup.append(option(g.id, g.name)));
        rankGroup.value = selectedGroup; rankGroup.dataset.signature = groupSignature;
      }
      rankGroup.closest('label').hidden = !availableGroups.length;
      const peerType = FamilyModel.hasSeniority(type.value) || type.value === 'fellowDisciple';
      const relation = { seniority: seniority.value, groupId: rankGroup.value || undefined };
      const role = person && peerType ? FamilyModel.peerPresentation(snapshot.data, person, base, type.value, relation).role : labels[type.value];
      if (person) {
        seniority.options[1].textContent = `${person.name}比${base.name}年長`;
        seniority.options[2].textContent = `${person.name}比${base.name}年幼`;
      }
      const inverse = {parent:'child',child:'parent',grandparent:'grandchild',grandchild:'grandparent',teacher:'student',student:'teacher'};
      const reverseRole = person && peerType ? FamilyModel.peerPresentation(snapshot.data, base, person, type.value, { ...relation, seniority: FamilyModel.inverseSeniority(seniority.value) }).role : labels[inverse[type.value] || type.value];
      preview.textContent = person && type.value ? `${person.name}是${base.name}的${role}${isParent ? '（' + kind.value + '）' : ''}；${base.name}是${person.name}的${reverseRole}${isParent ? '（' + kind.value + '）' : ''}` : '請選擇對象與關係。';
      summaryTitle.textContent = person && type.value ? `${person.name} · ${role || labels[type.value] || type.value}` : '尚未完成的關係';
      summaryHint.textContent = person && type.value && isParent ? kind.value : person && type.value && FamilyModel.hasSeniority(type.value) && seniority.value !== 'unknown' ? (seniority.value === 'older' ? '對方年長' : '對方年幼') : '';
    }
    row.addEventListener('change', () => { update(); scheduleMemberDraft(); });
    row.addEventListener('input', scheduleMemberDraft);
    row.updatePreview = update;
    row.expandEditor = () => setExpanded(true);
    if (initial) { target.value = initial.personId; type.value = initial.type; if (initial.kind) kind.value = initial.kind; seniority.value = initial.seniority || 'unknown'; source.value = initial.source || ''; note.value = initial.note || ''; state.value = initial.status || 'confirmed'; }
    relations.appendChild(row); update(); setExpanded(expanded); scheduleMemberDraft(); if (!initial) target.focus();
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
    for (const key of ['name', 'location', 'position', 'notes', 'gender', 'siblingOrder', 'discipleOrder']) form.elements.namedItem(key).value = person[key] ?? '';
    relations.replaceChildren();
    FamilyModel.relationshipsFor(snapshot.data, editingId).forEach(addRelation);
  }
  function openMember(id = null, plan = null) {
    if (restoredBackup) { showStatus('目前為瀏覽器備份，請重新連線並重新整理後再編輯。', 'warning'); return; }
    editingId = id; currentPlanId = plan?.id || null;
    form.reset(); relations.replaceChildren(); error.textContent = ''; showStatus(''); requestId = crypto.randomUUID();
    document.getElementById('intermediate-context')?.remove();
    document.getElementById('member-dialog-title').textContent = editingId ? '編輯成員與關係' : '新增成員';
    document.getElementById('refresh-family').textContent = editingId ? '重新載入成員' : '更新資料';
    if (editingId) populateMember();
    if (plan) {
      document.getElementById('member-dialog-title').textContent = plan.title;
      form.elements.namedItem('gender').value = plan.gender;
      const context = document.createElement('div'); context.id = 'intermediate-context'; context.className = 'form-note';
      const note = document.createElement('p'); note.textContent = '已帶入親生關係，請確認後填寫新成員資料。儲存後會更新連線中的節點。'; context.appendChild(note);
      const contextActions = document.createElement('div'); contextActions.className = 'intermediate-context-actions';
      const ignore = document.createElement('button'); ignore.type = 'button'; ignore.className = 'plain-button intermediate-ignore-button'; ignore.textContent = '不再顯示此待補親屬';
      ignore.addEventListener('click', async () => {
        if (saving) return;
        error.textContent = ''; ignore.disabled = true;
        try {
          const payload = await updateIntermediateIgnored(plan.id, true);
          closeMemberNow(true);
          showUndoStatus(`已忽略待補項目「${plan.title}」，可從「已忽略待補項目」恢復。`, payload);
        } catch (e) { error.textContent = e.message; ignore.disabled = false; }
      });
      contextActions.appendChild(ignore); context.appendChild(contextActions);
      function fill(choice) {
        relations.replaceChildren();
        plan.relationships.forEach(addRelation);
        if (choice) addRelation(choice.relationship);
      }
      fill(plan.choices.length === 1 ? plan.choices[0] : null);
      if (plan.choices.length > 1) {
        const label = document.createElement('label'); label.textContent = '這位新成員是哪位已知父母的親生手足？';
        const select = document.createElement('select'); select.id = 'intermediate-choice'; select.required = true;
        select.appendChild(option('', '請選擇銜接的親生父母'));
        plan.choices.forEach(choice => select.appendChild(option(choice.personId, choice.label)));
        select.addEventListener('change', () => fill(plan.choices.find(choice => choice.personId === select.value)));
        label.appendChild(select); context.appendChild(label);
      }
      document.getElementById('member-fields').prepend(context);
      [...relations.children].forEach(row => row.updatePreview());
    }
    setSaving(false);
    resetMemberBaseline();
    dialog.showModal();
    offerMemberDraft();
    if (!draftDialog.open) document.getElementById('member-name').focus();
  }
  window.addIntermediateMember = planId => {
    const plan = FamilyModel.intermediatePlans(snapshot.data).find(p => p.id === planId);
    if (plan) openMember(null, plan);
    else showStatus('此中間關係已更新，請重新整理後再選擇。', 'warning');
  };
  async function updateIntermediateIgnored(planId, ignored) {
    const response = await FamilyRepository.request('/api/family/intermediate-ignore', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ planId, ignored, version: snapshot.version })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || '無法更新待補項目。');
    accept(payload);
    return payload;
  }
  function renderIgnoredIntermediatePlans() {
    if (!ignoredList || !snapshot) return;
    ignoredError.textContent = '';
    const ignored = new Set(FamilyModel.ignoredIntermediatePlanIds(snapshot.data));
    const seenSlots = new Set();
    const plans = FamilyModel.intermediatePlans(snapshot.data, { includeIgnored: true }).filter(plan => ignored.has(plan.id) && !seenSlots.has(plan.slotId) && seenSlots.add(plan.slotId));
    ignoredList.replaceChildren();
    ignoredEmpty.hidden = plans.length > 0;
    plans.forEach(plan => {
      const item = document.createElement('div'); item.className = 'ignored-intermediate-item';
      const text = document.createElement('div');
      const title = document.createElement('strong'); title.textContent = plan.title;
      const note = document.createElement('p'); note.className = 'form-note'; note.textContent = '恢復後會重新在族譜圖上顯示待補「＋」。';
      text.append(title, note);
      const restore = document.createElement('button'); restore.type = 'button'; restore.className = 'plain-button'; restore.textContent = '恢復待補';
      restore.addEventListener('click', async () => {
        restore.disabled = true; ignoredError.textContent = '';
        try {
          const payload = await updateIntermediateIgnored(plan.id, false);
          showUndoStatus(`已恢復待補項目「${plan.title}」。`, payload);
          renderIgnoredIntermediatePlans();
        } catch (e) { ignoredError.textContent = e.message; }
        finally { restore.disabled = false; }
      });
      item.append(text, restore); ignoredList.appendChild(item);
    });
  }
  window.openIgnoredIntermediatePlans = () => {
    if (!snapshot || !ignoredDialog) return;
    renderIgnoredIntermediatePlans();
    ignoredDialog.showModal();
  };
  document.getElementById('close-ignored-intermediates')?.addEventListener('click', () => ignoredDialog.close());

  function setNameSaving(value) {
    savingName = value;
    document.getElementById('family-name-fields').disabled = value;
    ['save-family-name', 'refresh-family-name', 'cancel-family-name', 'close-family-name-dialog'].forEach(id => document.getElementById(id).disabled = value);
    document.getElementById('save-family-name').textContent = value ? '儲存中…' : '儲存名稱';
  }
  familyNameButton.addEventListener('click', () => {
    if (!snapshot) return;
    nameVersion = snapshot.version;
    nameInput.value = FamilyModel.normalizeFamilyName(snapshot.data.familyName);
    nameError.textContent = '';
    setNameSaving(false);
    nameDialog.showModal();
    nameInput.focus(); nameInput.select();
  });
  ['cancel-family-name', 'close-family-name-dialog'].forEach(id => document.getElementById(id).addEventListener('click', () => nameDialog.close()));
  nameDialog.addEventListener('cancel', event => { if (savingName) event.preventDefault(); });
  document.getElementById('refresh-family-name').addEventListener('click', async () => {
    if (savingName) return;
    nameError.textContent = '';
    try {
      await load();
      nameVersion = snapshot.version;
      nameError.textContent = '已更新目前資料，請確認名稱後再儲存。輸入內容已保留。';
    } catch (e) { nameError.textContent = e.message; }
  });
  nameForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (savingName || !nameForm.reportValidity()) return;
    nameError.textContent = '';
    let familyName;
    try { familyName = FamilyModel.normalizeFamilyName(nameInput.value); }
    catch (e) { nameError.textContent = e.message; return; }
    setNameSaving(true);
    try {
      const response = await FamilyRepository.request('/api/family/name', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ familyName, version: nameVersion }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || '儲存名稱失敗，請重試。');
      accept(payload);
      nameDialog.close();
      showUndoStatus(`已將家族名稱更新為「${familyName}」。`, payload);
    } catch (e) { nameError.textContent = e.message || '連線中斷，請重試。'; }
    finally { setNameSaving(false); }
  });
  addButton.addEventListener('click', () => openMember());
  window.editFamilyMember = openMember;
  window.FamilyEditor = {
    snapshot: () => snapshot,
    editingId: () => editingId,
    async manage(body) {
      if (restoredBackup) throw new Error('目前為備份檢視，請重新連線後再編輯。');
      const response = await FamilyRepository.request('/api/family/manage', { method: 'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify(body) });
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error || '無法儲存。');
      accept(payload); showUndoStatus('已儲存修改。', payload); return payload;
    },
    undo: () => undoLastChange(snapshot.version),
    addRelative(id, type) { openMember(); addRelation({ personId: id, type, ...(FamilyModel.isDescent(type) ? {kind:'親生'} : {}) }, {expanded:true}); resetMemberBaseline(); },
    complete(id, targetId, category, message) {
      if (message.includes('性別')) { openMember(targetId); form.elements.namedItem('gender').focus(); return; }
      openMember(id);
      const type = category === 'fellowDisciples' ? 'fellowDisciple' : category === 'cousins' ? 'tangCousin' : 'sibling';
      let row = [...relations.children].find(row => row.querySelector('.relation-target').value === targetId && (row.querySelector('.relation-type').value === type || row.querySelector('.relation-type').value === 'swornSibling'));
      if (!row) { addRelation({personId:targetId,type}, {expanded:true}); row = relations.lastElementChild; }
      row.expandEditor(); row.scrollIntoView({block:'center'});
      if (type === 'fellowDisciple') form.elements.namedItem('discipleOrder').focus();
      else row.querySelector(message.includes('群組') ? '.relation-group' : '.relation-cousin-seniority').focus();
    }
  };
  window.completeFamilyRelationship = (...args) => window.FamilyEditor.complete(...args);
  ['close-member-dialog', 'cancel-member'].forEach(id => document.getElementById(id).addEventListener('click', requestMemberClose));
  dialog.addEventListener('cancel', event => {
    event.preventDefault();
    requestMemberClose();
  });
  keepEditingButton.addEventListener('click', () => { pendingMemberClose = null; unsavedDialog.close(); dialog.focus(); });
  discardChangesButton.addEventListener('click', () => { if (pendingMemberClose) closeMemberNow(true); });
  unsavedDialog.addEventListener('cancel', event => { event.preventDefault(); pendingMemberClose = null; unsavedDialog.close(); dialog.focus(); });
  resumeDraftButton.addEventListener('click', () => {
    const draft = pendingDraft; pendingDraft = null; draftDialog.close();
    restoreMemberDraft(draft); dialog.focus();
  });
  discardDraftButton.addEventListener('click', () => {
    clearMemberDraft(); draftDialog.close(); document.getElementById('member-name').focus();
  });
  draftDialog.addEventListener('cancel', event => { event.preventDefault(); });
  dialog.addEventListener('close', () => { pendingMemberClose = null; memberBaseline = ''; currentPlanId = null; pendingDraft = null; });
  form.addEventListener('input', scheduleMemberDraft);
  form.addEventListener('change', scheduleMemberDraft);
  window.addEventListener('pagehide', persistMemberDraft);
  document.getElementById('add-relation').addEventListener('click', () => addRelation());
  document.getElementById('member-disciple-order').addEventListener('input', () => [...relations.children].forEach(row => row.updatePreview()));
  document.getElementById('member-name').addEventListener('input', () => [...relations.children].forEach(row => row.updatePreview()));
  ['gender','siblingOrder'].forEach(name => form.elements.namedItem(name).addEventListener('input', () => [...relations.children].forEach(row => row.updatePreview())));
  document.getElementById('refresh-family').addEventListener('click', async () => {
    error.textContent = '';
    try {
      await load();
      if (editingId) { populateMember(); resetMemberBaseline(); clearMemberDraft(); error.textContent = '已載入此成員的最新資料，請重新套用修改。'; }
      else { relations.querySelectorAll('.relation-target').forEach(updateTargets); [...relations.children].forEach(row => row.updatePreview()); showStatus('已更新資料，表單內容已保留。', 'info'); }
    }
    catch (e) { error.textContent = e.message; }
  });
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (saving || !form.reportValidity()) return;
    error.textContent = '';
    const values = new FormData(form);
    const member = {
      name: values.get('name').trim(), location: values.get('location').trim(), position: values.get('position').trim(), gender: values.get('gender'),
      notes: values.get('notes').trim(),
      discipleOrder: values.get('discipleOrder') === '' ? null : Number(values.get('discipleOrder')),
      siblingOrder: values.get('siblingOrder') === '' ? null : Number(values.get('siblingOrder')),
      relationships: [...relations.children].map(row => {
        const type = row.querySelector('.relation-type').value;
        const r = { type, personId: row.querySelector('.relation-target').value };
        if (FamilyModel.hasSeniority(type) && row.querySelector('.relation-cousin-seniority').value !== 'unknown') r.seniority = row.querySelector('.relation-cousin-seniority').value;
        for (const key of ['note','source','status']) { const value = row.querySelector('.relation-' + key).value.trim(); if (value && (key !== 'status' || value === 'pending')) r[key] = value; }
        if (row.querySelector('.relation-group').value) r.groupId = row.querySelector('.relation-group').value;
        if (FamilyModel.isDescent(type)) r.kind = row.querySelector('.relation-kind').value;
        return r;
      })
    };
    setSaving(true);
    try {
      const candidate = { ...member, id: editingId || 'p-' + requestId };
      if (editingId) FamilyModel.replaceMember(snapshot.data, candidate);
      else FamilyModel.build({ ...snapshot.data, people: [...snapshot.data.people, candidate] });
      const response = await FamilyRepository.request(editingId ? '/api/members/' + encodeURIComponent(editingId) : '/api/members', { method: editingId ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ member, requestId, version: snapshot.version }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || '儲存失敗，請重試。');
      document.getElementById('family-filter').value = '';
      clearMemberDraft();
      accept(payload); closeMemberNow(true);
      // Keep the diagram available for filling the next intermediate slot.
      window.selectFamilyMember(document.getElementById('intermediate-context') ? null : payload.memberId);
      showUndoStatus(`已${editingId ? '更新' : '新增'}「${member.name}」。`, payload);
    } catch (e) {
      error.textContent = e.message || '連線中斷，請重試。';
      setSaving(false);
      const row = [...relations.children].find(row => e.personIds?.includes(row.querySelector('.relation-target').value));
      if (row) { row.expandEditor(); row.scrollIntoView({block:'center'}); row.querySelector('.relation-cousin-seniority:not(:disabled), .relation-type')?.focus(); }
      else {
        const field = e.field || (e.message.includes('姓名') ? 'name' : e.message.includes('師門次序') ? 'discipleOrder' : e.message.includes('手足次序') ? 'siblingOrder' : null);
        const control = field && form.elements.namedItem(field);
        if (control) { control.scrollIntoView({block:'center'}); control.focus(); }
        else { error.tabIndex = -1; error.scrollIntoView({block:'center'}); error.focus(); }
      }
    }
    finally { setSaving(false); }
  });
  const importDialog = document.getElementById('import-dialog');
  const importFile = document.getElementById('import-file');
  const importError = document.getElementById('import-error');
  let stagedImport = null, importVersion = null, importing = false;
  function importSummary() {
    document.getElementById('import-summary').textContent = `檔案：${stagedImport.name}。將以 ${stagedImport.data.people.length} 位成員取代目前的 ${snapshot.data.people.length} 位成員。`;
    window.renderFamilyDifferences?.(document.getElementById('import-summary').parentElement, snapshot.data, stagedImport.data);
  }
  document.getElementById('import-json').addEventListener('click', () => { importFile.value = ''; importFile.click(); });
  importFile.addEventListener('change', async () => {
    const file = importFile.files[0]; if (!file) return;
    stagedImport = null; showStatus(''); importError.textContent = '';
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error('JSON 檔案不能超過 5 MB。');
      let data;
      try { data = JSON.parse((await file.text()).replace(/^\uFEFF/, '')); } catch { throw new Error('檔案不是有效的 JSON，請檢查內容後重新選擇。'); }
      FamilyModel.build(data);
      stagedImport = { data, name: file.name }; importVersion = snapshot.version;
      importSummary(); importDialog.showModal();
    } catch (e) { showStatus('無法匯入：' + e.message, 'error'); }
  });
  function cancelImport() { if (importing) return; stagedImport = null; importDialog.close(); }
  document.getElementById('cancel-import').addEventListener('click', cancelImport);
  document.getElementById('close-import-dialog').addEventListener('click', cancelImport);
  importDialog.addEventListener('cancel', event => { if (importing) event.preventDefault(); else stagedImport = null; });
  document.getElementById('refresh-import').addEventListener('click', async () => {
    try { await load(); importVersion = snapshot.version; importSummary(); importError.textContent = '已更新目前資料，請確認取代範圍後再匯入。'; }
    catch (e) { importError.textContent = e.message; }
  });
  document.getElementById('confirm-import').addEventListener('click', async () => {
    if (importing || !stagedImport) return;
    importing = true; importError.textContent = '';
    ['confirm-import', 'cancel-import', 'refresh-import', 'close-import-dialog'].forEach(id => document.getElementById(id).disabled = true);
    try {
      const response = await FamilyRepository.request('/api/family/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: stagedImport.data, version: importVersion }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || '匯入失敗，請重試。');
      document.getElementById('family-filter').value = '';
      delete document.querySelector('.tree').dataset.scope;
      window.clearRecentFamilyMembers?.();
      window.clearFamilyViewState?.();
      accept(payload); window.selectFamilyMember(null);
      importDialog.close(); stagedImport = null;
      showUndoStatus(`已匯入 ${payload.data.people.length} 位成員，並保留匯入前備份。`, payload);
    } catch (e) { importError.textContent = e.message; }
    finally { importing = false; ['confirm-import', 'cancel-import', 'refresh-import', 'close-import-dialog'].forEach(id => document.getElementById(id).disabled = false); }
  });
  document.getElementById('export-json').addEventListener('click', async () => {
    const button = document.getElementById('export-json'); button.disabled = true;
    try {
      // Export the latest persisted JSON, including changes from other open pages.
      const response = restoredBackup ? new Response(JSON.stringify(snapshot.data, null, 2), { headers: { 'Content-Type': 'application/json' } }) : await FamilyRepository.request('/api/family/export', { cache: 'no-store' });
      if (!response.ok) throw new Error((await response.json()).error || '匯出失敗。');
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a'); link.href = url; link.download = 'family.json';
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      showStatus('已匯出目前族譜資料。');
    } catch (e) { showStatus('無法匯出：' + e.message, 'error'); }
    finally { button.disabled = false; }
  });
  window.addEventListener('familyrepositorychange', event => {
    if (event.detail?.source !== 'cloud' || !event.detail.payload) return;
    const editing = dialog.open || nameDialog.open || importDialog.open;
    if (editing) {
      showStatus('Google Drive 已下載較新的族譜；目前表單仍保留原輸入。請按「更新資料」後再儲存，避免覆蓋雲端版本。', 'warning');
      return;
    }
    accept(event.detail.payload);
    document.getElementById('family-filter').value = '';
    delete document.querySelector('.tree').dataset.scope;
    window.selectFamilyMember(null);
    showStatus('已從 Google Drive 載入較新的族譜資料。', 'info');
  });
  load().catch(e => {
    const cached = FamilyRepository.isStatic ? null : backup.read();
    if (cached) { accept(cached, true); return; }
    const canvas = document.getElementById('tree-canvas');
    canvas.replaceChildren();
    const message = document.createElement('p'); message.className = 'tree__error';
    message.textContent = location.protocol === 'file:' ? '請先執行 node server.cjs，再開啟 http://127.0.0.1:4173，才能讀取與儲存族譜。' : e.message;
    canvas.appendChild(message);
  });
})();
