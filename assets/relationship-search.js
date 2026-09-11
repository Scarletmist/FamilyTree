(function () {
  'use strict';
  window.FamilyRelationshipSearch = { createController({ onChange }) {
    const form = document.getElementById('relationship-search');
    const a = document.getElementById('relationship-a'), b = document.getElementById('relationship-b');
    const summary = document.getElementById('relationship-summary');
    const status = document.getElementById('kinship-status'), submit = form.querySelector('[type=submit]');
    const retry = document.getElementById('kinship-retry');
    let engine, config, graph, active = false, pathIndex = 0;
    const el = (tag, text) => { const node = document.createElement(tag); node.textContent = text; return node; };
    const mobile = matchMedia('(max-width:700px), (max-width:950px) and (max-height:520px) and (pointer:coarse)');
    const landscape = matchMedia('(max-width:950px) and (max-height:520px) and (pointer:coarse) and (orientation:landscape)');
    const home = document.createComment('relationship search'); form.before(home);
    const bar = el('div'); bar.className = 'mobile-search-bar'; home.after(bar);
    const button = (text, id) => { const node = el('button', text); node.type = 'button'; if (id) node.id = id; return node; };
    const open = button('查詢兩人關係 ›', 'mobile-search-open'), end = button('✕', 'mobile-search-end');
    end.setAttribute('aria-label', '結束比較，顯示全部'); end.hidden = true; bar.append(open, end);

    const dialog = el('dialog'); dialog.className = 'relationship-sheet'; dialog.setAttribute('aria-labelledby', 'relationship-sheet-title');
    const header = el('header'), heading = el('h2', '查詢兩人關係'); heading.id = 'relationship-sheet-title';
    const close = button('✕', 'relationship-sheet-close'); close.setAttribute('aria-label', '關閉查詢'); header.append(heading, close); dialog.append(header); document.body.append(dialog);

    const resultDialog = el('dialog');
    resultDialog.id = 'relationship-result-sheet';
    resultDialog.className = 'relationship-result-sheet';
    resultDialog.setAttribute('aria-labelledby', 'relationship-result-sheet-title');
    const resultHeader = el('header'); resultHeader.className = 'relationship-result-sheet__header';
    const resultTitle = el('h2', '關係詳情'); resultTitle.id = 'relationship-result-sheet-title';
    const resultClose = button('✕', 'relationship-result-sheet-close'); resultClose.className = 'details-icon'; resultClose.setAttribute('aria-label', '關閉關係詳情');
    resultHeader.append(resultTitle, resultClose);
    const resultBody = el('div'); resultBody.className = 'relationship-result-sheet__body';
    resultDialog.append(resultHeader, resultBody); document.body.append(resultDialog);

    const hint = el('p', '查詢：A 是 B 的誰？'); hint.className = 'relationship-direction'; form.append(hint);
    a.closest('label').classList.add('relationship-field-a'); b.closest('label').classList.add('relationship-field-b');
    a.closest('label').prepend(el('span', '想知道誰與他的關係？')); b.closest('label').prepend(el('span', '以誰為稱呼基準？'));
    [a, b].forEach(select => select.closest('label').firstElementChild.classList.add('relationship-field-caption'));
    const nameToggle = document.getElementById('toggle-canvas-names'), toggleHome = nameToggle.parentElement;
    let draft = null;

    function openSheet() { closeResultDetails(); draft = { a: a.value, b: b.value, active, pathIndex }; dialog.showModal(); }
    function closeSheet(cancel = true) {
      if (cancel && draft) { a.value = draft.a; b.value = draft.b; active = draft.active; pathIndex = draft.pathIndex; onChange(); }
      draft = null; dialog.close(); open.focus();
    }
    function closeResultDetails() { if (resultDialog.open) resultDialog.close(); }
    function openResultDetails() {
      if (!active || resultDialog.open) return;
      if (landscape.matches) resultDialog.show();
      else resultDialog.showModal();
      resultClose.focus();
    }

    open.addEventListener('click', openSheet); close.addEventListener('click', () => closeSheet());
    dialog.addEventListener('cancel', event => { event.preventDefault(); closeSheet(); });
    dialog.addEventListener('click', event => { if (mobile.matches && event.target === dialog) closeSheet(); });
    end.addEventListener('click', () => document.getElementById('relationship-reset').click());
    resultClose.addEventListener('click', closeResultDetails);
    resultDialog.addEventListener('cancel', event => { event.preventDefault(); closeResultDetails(); });
    resultDialog.addEventListener('click', event => { if (event.target === resultDialog && !landscape.matches) closeResultDetails(); });

    function layout() {
      if (mobile.matches) { dialog.append(form); bar.append(nameToggle); }
      else {
        if (dialog.open) closeSheet();
        closeResultDetails();
        home.after(form); toggleHome.append(nameToggle);
      }
    }
    mobile.addEventListener('change', () => { layout(); onChange(); });
    landscape.addEventListener('change', () => { closeResultDetails(); onChange(); });
    layout();

    async function load() {
      submit.disabled = true; retry.hidden = true; status.textContent = '正在載入稱謂設定…';
      try {
        const response = await fetch('data/kinship-terms.json', { cache: 'no-store' });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        config = await response.json(); engine = FamilyKinship.create(config);
        status.textContent = ''; submit.disabled = !graph; onChange();
      } catch (error) {
        engine = null; active = false; status.textContent = '稱謂設定檔載入失敗，請檢查檔案後重試。'; retry.hidden = false; onChange();
      }
    }
    retry.addEventListener('click', load);
    form.addEventListener('submit', event => { event.preventDefault(); if (!engine || !a.value || !b.value) return; active = true; pathIndex = 0; onChange(); if (dialog.open) closeSheet(false); });
    [a, b].forEach(select => select.addEventListener('change', () => { active = false; pathIndex = 0; closeResultDetails(); onChange(); }));
    document.getElementById('relationship-swap').addEventListener('click', () => { const first = a.value; a.value = b.value; b.value = first; pathIndex = 0; onChange(); });
    document.getElementById('relationship-reset').addEventListener('click', () => { active = false; closeResultDetails(); document.getElementById('family-filter').value = ''; onChange(); });

    function appendFullDetails(container, result, path, byId, nameA, nameB) {
      container.replaceChildren();
      container.append(el('p', 'A：' + nameA + '　B（稱呼基準）：' + nameB));
      if (path) {
        container.append(el('p', '關係路徑：' + path.nodes.map(id => byId.get(id).name).join(' → ')));
        path.notes.forEach(note => container.append(el('p', note)));
      } else container.append(el('p', '目前僅顯示這兩位成員；可編輯成員補上已知關係。'));
      if (result.paths.length > 1) {
        if (mobile.matches) {
          // Native <select> can make iOS Safari zoom/pan the visual viewport in landscape.
          // Use an in-sheet disclosure list on mobile so changing paths never invokes the native picker.
          const picker = document.createElement('details'); picker.className = 'relationship-path-picker';
          const current = result.paths[pathIndex];
          const pickerSummary = el('summary', '其他關係路徑：' + (pathIndex + 1) + '. ' + current.title);
          const options = el('div'); options.className = 'relationship-path-options'; options.setAttribute('role', 'listbox'); options.setAttribute('aria-label', '其他關係路徑');
          result.paths.forEach((p, i) => {
            const optionButton = button((i + 1) + '. ' + p.title + '：' + p.nodes.map(id => byId.get(id).name).join(' → '));
            optionButton.className = 'relationship-path-option'; optionButton.setAttribute('role', 'option');
            optionButton.setAttribute('aria-selected', String(i === pathIndex)); optionButton.setAttribute('aria-current', String(i === pathIndex));
            optionButton.addEventListener('click', () => { if (i === pathIndex) { picker.open = false; return; } pathIndex = i; onChange(); });
            options.append(optionButton);
          });
          picker.append(pickerSummary, options); container.append(picker);
        } else {
          const label = el('label', '其他關係路徑 '), select = document.createElement('select');
          select.setAttribute('aria-label', '其他關係路徑');
          result.paths.forEach((p, i) => { const option = el('option', (i + 1) + '. ' + p.title + '：' + p.nodes.map(id => byId.get(id).name).join(' → ')); option.value = i; select.append(option); });
          select.value = pathIndex;
          select.addEventListener('change', () => { pathIndex = Number(select.value); onChange(); });
          label.append(select); container.append(label);
        }
      }
      if (result.truncated) container.append(el('p', '等長路徑較多，目前列出前 12 條。'));
      const source = config.sources?.[0];
      if (source && /^https:\/\//.test(source.url)) {
        const link = el('a', '稱謂依據：' + source.title); link.className = 'kinship-source'; link.href = source.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; container.append(link);
      }
    }

    function update(fullGraph) {
      graph = fullGraph;
      const names = FamilyModel.memberOptionLabels(fullGraph.people);
      const relationshipMemberIds = FamilyModel.relationshipMemberIds(fullGraph.people);
      const relationshipPeople = fullGraph.people.filter(person => relationshipMemberIds.has(person.id));
      for (const select of [a, b]) {
        const previous = select.value;
        select.replaceChildren(el('option', '請選擇成員')); select.options[0].value = '';
        relationshipPeople.forEach(p => { const option = el('option', names.get(p.id)); option.value = p.id; select.append(option); });
        select.value = relationshipMemberIds.has(previous) ? previous : '';
      }
      submit.disabled = !engine || !a.value || !b.value;
      hint.textContent = a.value && b.value ? '查詢：' + names.get(a.value) + ' 是 ' + names.get(b.value) + ' 的誰？' : '查詢：A 是 B 的誰？';
      if (!a.value || !b.value) active = false;
      summary.hidden = !active; summary.replaceChildren();
      document.getElementById('family-filter').disabled = active;
      open.textContent = active ? names.get(a.value) + ' → ' + names.get(b.value) + '　修改' : '查詢兩人關係 ›';
      end.hidden = !active;
      bar.dataset.active = active ? 'true' : 'false';
      if (!active) {
        summary.classList.remove('relationship-summary--compact');
        closeResultDetails();
        resultBody.replaceChildren();
        return { graph: fullGraph, active: false };
      }

      const result = engine.query(fullGraph, a.value, b.value);
      pathIndex = Math.min(pathIndex, Math.max(0, result.paths.length - 1));
      const path = result.paths[pathIndex], byId = new Map(fullGraph.people.map(p => [p.id, p]));
      const nameA = byId.get(a.value).name, nameB = byId.get(b.value).name;
      const titleText = path ? nameA + ' 為 ' + nameB + ' 的' + path.title : nameA + ' 與 ' + nameB + ' 尚無已記錄的連接關係';

      if (mobile.matches) {
        summary.classList.add('relationship-summary--compact');
        const compactTitle = el('h2', titleText);
        const actions = el('div'); actions.className = 'relationship-summary__actions';
        const details = button('路徑'); details.className = 'plain-button relationship-result-details'; details.setAttribute('aria-label', '查看完整關係路徑'); details.addEventListener('click', openResultDetails);
        const modify = button('修改', 'relationship-result-edit'); modify.className = 'plain-button mobile-result-edit'; modify.addEventListener('click', openSheet);
        const finish = button('✕'); finish.className = 'plain-button relationship-result-end'; finish.setAttribute('aria-label', '結束比較，顯示全部'); finish.addEventListener('click', () => document.getElementById('relationship-reset').click());
        actions.append(details, modify, finish); summary.append(compactTitle, actions);
        resultTitle.textContent = nameA + ' 與 ' + nameB + ' 的關係詳情';
        appendFullDetails(resultBody, result, path, byId, nameA, nameB);
      } else {
        summary.classList.remove('relationship-summary--compact');
        summary.append(el('h2', titleText));
        const details = el('div'); details.className = 'relationship-result-desktop-details';
        appendFullDetails(details, result, path, byId, nameA, nameB);
        summary.append(...details.childNodes);
      }

      return { active: true, graph: engine.project(fullGraph, path, [a.value, b.value]), scope: [a.value, b.value, pathIndex].join('|'), aId: a.value, bId: b.value };
    }
    function startWithMember(personId) {
      if (!graph?.people.some(person => person.id === personId) || !FamilyModel.relationshipMemberIds(graph.people).has(personId)) return false;
      a.value = '';
      b.value = personId;
      active = false;
      pathIndex = 0;
      closeResultDetails();
      // Dispatching change also refreshes the custom searchable-select trigger text.
      b.dispatchEvent(new Event('change', { bubbles: true }));
      if (mobile.matches) {
        if (!dialog.open) openSheet();
      } else {
        const trigger = a.closest('.searchable-select')?.querySelector('.select-trigger');
        (trigger || a).focus({ preventScroll: false });
      }
      return true;
    }
    load();
    return { update, startWithMember };
  } };
})();
