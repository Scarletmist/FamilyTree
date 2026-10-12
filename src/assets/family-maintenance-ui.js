/* Reversible maintenance flows, sharing the existing editor and diff renderer. */
(function () {
  'use strict';
  const el = (tag,text,cls = '') => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; node.className = cls; return node; };
  const button = (label,action,cls = 'plain-button') => { const node = el('button',label,cls); node.type = 'button'; node.addEventListener('click',action); return node; };
  const snapshot = () => FamilyApp.snapshot();
  const date = value => new Date(value).toLocaleString('zh-TW',{ hour12:false });
  let sequence = 0;
  const panels = new Map();
  function modal(title,id) {
    const opener = document.activeElement, dialog = el('dialog',undefined,'family-management-dialog family-maintenance-dialog');
    if (id) dialog.id = id;
    const heading = el('h2',title); heading.id = 'maintenance-title-' + ++sequence; dialog.setAttribute('aria-labelledby',heading.id);
    const header = el('div',undefined,'dialog-header'), content = el('div',undefined,'dialog-scroll'), actions = el('div',undefined,'form-actions');
    const error = el('p','','form-error'); error.setAttribute('role','alert'); error.tabIndex = -1;
    const close = button('',() => { if (!dialog.dataset.busy) dialog.close(); },'details-icon'); close.setAttribute('aria-label','關閉' + title);
    close.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18 M6 6l12 12" /></svg>';
    header.append(heading,close); dialog.append(header,content,error,actions); document.body.append(dialog);
    dialog.addEventListener('cancel',event => { if (dialog.dataset.busy) event.preventDefault(); });
    dialog.addEventListener('close',() => {
      dialog.remove();
      if (opener?.isConnected && !opener.closest('[hidden]')) opener.focus({ preventScroll:true });
      else document.querySelector('dialog[open] .maintenance-search')?.focus({ preventScroll:true });
    });
    return { dialog,heading,content,actions,error,open:() => dialog.showModal() };
  }
  function busy(ui,value) {
    if (value) ui.dialog.dataset.busy = 'true'; else delete ui.dialog.dataset.busy;
    ui.dialog.querySelectorAll('button,input,textarea,select').forEach(node => { node.disabled = value; });
  }
  function check(parent,label,checked = true) {
    const row = el('label',undefined,'maintenance-choice'), input = el('input'); input.type = 'checkbox'; input.checked = checked;
    row.append(input,el('span',label)); parent.append(row); return input;
  }
  function openLifecycle(type,id) {
    const titles = { archiveMember:'封存成員',unarchiveMember:'解除封存',deleteMember:'移至回收區',restoreMember:'還原成員' };
    if (!titles[type]) return;
    const ui = modal(titles[type],'member-lifecycle-dialog');
    const introduction = { archiveMember:'封存會保留成員與親屬關係；一般清單、關係對象選單、地圖及待整理項目會排除這位成員。必要的族譜銜接仍會標示已封存。',
      unarchiveMember:'恢復一般清單、關係選單及地圖資格；所在地座標保留，背景定位會重新檢查是否適用。',
      deleteMember:'只移除此成員，清理相關關係與排行引用，不連帶刪除親屬，也不會自動接成新的關係。回收資料仍保留在 JSON 備份與雲端同步中，可日後還原。',
      restoreMember:'以目前族譜重新檢查關係與排行。請明確選擇要還原的內容；無法原樣還原的項目會列出原因。' };
    ui.content.append(el('p',introduction[type],'form-note'));
    const reason = el('textarea'); reason.maxLength = 2000; reason.rows = 2; reason.setAttribute('aria-label','封存原因（選填）');
    if (type === 'archiveMember') { const label = el('label','封存原因（選填）','management-field'); label.append(reason); ui.content.append(label); }
    const choices = el('div'), preview = el('div'); ui.content.append(choices,preview);
    let staged = null, relationshipChoices = new Map(), groupChoices = new Map(), orderChoices = new Map(), choicesVersion = null;
    const commit = button('確認' + titles[type],async () => {
      if (!staged) return;
      busy(ui,true); ui.error.textContent = '';
      try { await FamilyEditor.lifecycle(staged); ui.dialog.close(); }
      catch (error) { staged = null; ui.error.textContent = error.message; ui.error.focus(); }
      finally { busy(ui,false); commit.disabled = !staged; }
    },type === 'deleteMember' ? 'maintenance-danger plain-button' : 'primary-button'); commit.disabled = true;
    function invalidate() { staged = null; commit.disabled = true; preview.replaceChildren(); }
    reason.addEventListener('input',invalidate);
    function restoreOptions(current) {
      if (choicesVersion === current.version) return;
      const entry = current.data.recycleBin?.find(e => e.id === id);
      choices.replaceChildren(); relationshipChoices = new Map(); groupChoices = new Map(); orderChoices = new Map(); choicesVersion = current.version;
      if (!entry) return;
      const names = new Map([...current.data.people,...(current.data.recycleBin || []).map(e => e.person)].map(p => [p.id,p.name]));
      const edges = RelationshipEvidence.records({ people:[entry.person,...entry.incomingRelationships.map(r => ({ id:r.ownerId,relationships:[r.relation] }))] });
      const details = el('details',undefined,'maintenance-restore-options'); details.open = true; details.append(el('summary','選擇還原內容'));
      details.append(el('p','取消勾選的關係或群組不會還原。調整後須重新預覽。','form-note'));
      for (const [key,edge] of edges) {
        const label = FamilyDiff.lines({ people:[],schemaVersion:3 },{ people:[{ id:edge.from,name:names.get(edge.from) || edge.from,relationships:[{ ...edge.relation,personId:edge.to }] },{ id:edge.to,name:names.get(edge.to) || edge.to,relationships:[] }],schemaVersion:3 }).find(text => text.startsWith('新增關係：'));
        const input = check(details,'還原關係：' + (label?.replace('新增關係：','') || key)); input.addEventListener('change',invalidate); relationshipChoices.set(key,input);
      }
      for (const ref of entry.groupReferences) {
        const name = current.data.rankGroups?.find(g => g.id === ref.groupId)?.name || ref.groupId;
        const input = check(details,'還原排行群組：' + name); input.addEventListener('change',invalidate); groupChoices.set(ref.groupId,input);
      }
      for (const [key,label] of [['siblingOrder','手足排行'],['discipleOrder','師門排行']]) if (entry.person[key] != null) {
        const input = check(details,`還原${label}：${entry.person[key]}（取消勾選改為未知）`); input.addEventListener('change',invalidate); orderChoices.set(key,input);
      }
      choices.append(details);
    }
    async function refresh() {
      invalidate(); busy(ui,true); ui.error.textContent = '';
      try {
        const current = await FamilyRepository.read();
        if (type === 'restoreMember') restoreOptions(current);
        const unchecked = values => [...values].filter(([,input]) => !input.checked).map(([key]) => key);
        const command = { type,id,version:current.version,...(type === 'archiveMember' ? { reason:reason.value } : {}),
          ...(type === 'restoreMember' ? { omitRelationships:unchecked(relationshipChoices),omitGroups:unchecked(groupChoices),clearOrders:unchecked(orderChoices) } : {}) };
        const result = await FamilyRepository.previewLifecycle(command);
        const person = current.data.people.find(p => p.id === id) || current.data.recycleBin?.find(e => e.id === id)?.person;
        ui.heading.textContent = titles[type] + '「' + (person?.name || id) + '」';
        const affected = result.affectedPersonIds.map(personId => current.data.people.find(p => p.id === personId)?.name || personId);
        preview.append(el('p',`影響 ${affected.length} 位成員：${affected.join('、')}`,'maintenance-impact'));
        if (result.conflicts.length) {
          const list = el('ul',undefined,'maintenance-conflicts');
          for (const conflict of result.conflicts) list.append(el('li',conflict.message));
          preview.append(el('h3','還原衝突'),list);
        }
        if (result.data) window.renderFamilyDifferences(preview,current.data,result.data,{ beforeLabel:'目前族譜',afterLabel:'操作後' });
        if (result.canApply && !result.unchanged) staged = { ...command,version:result.version };
        else if (result.unchanged) preview.append(el('p','此成員已是指定狀態，無需重複操作。','form-note'));
      } catch (error) { ui.error.textContent = error.message; }
      finally { busy(ui,false); commit.disabled = !staged; }
    }
    ui.actions.append(button('重新預覽',refresh),button('取消',() => ui.dialog.close()),commit); ui.open(); refresh();
  }
  function library(mode) {
    const id = mode === 'archive' ? 'archived-members-dialog' : 'recycle-bin-dialog';
    if (panels.get(id)?.dialog.isConnected) { panels.get(id).search.focus(); return; }
    const ui = modal(mode === 'archive' ? '封存成員' : '回收區',id);
    const search = el('input',undefined,'maintenance-search'); search.type = 'search'; search.placeholder = '搜尋姓名、原因或成員 ID'; search.setAttribute('aria-label','搜尋' + (mode === 'archive' ? '封存成員' : '回收成員'));
    const count = el('p','','form-note'), list = el('div',undefined,'maintenance-items'); count.setAttribute('role','status');
    ui.content.append(el('p',mode === 'archive' ? '封存保留關係，可解除封存或移至回收區。' : '回收資料不參與族譜與地圖；不會自動到期清除，仍保留於備份與同步。','form-note'),search,count,list);
    const draw = () => {
      const top = ui.content.scrollTop, data = snapshot()?.data; if (!data) return;
      const entries = mode === 'archive' ? data.people.filter(p => p.archive).map(p => ({ person:p,time:p.archive.archivedAt })) : (data.recycleBin || []).map(e => ({ ...e,time:e.deletedAt }));
      const keyword = FamilyMaintenance.normalize(search.value);
      const visible = entries.filter(e => FamilyMaintenance.normalize([e.person.name,e.person.id,e.person.archive?.reason].join(' ')).includes(keyword));
      count.textContent = `${entries.length} 位${mode === 'archive' ? '封存' : '回收'}成員；顯示 ${visible.length} 位`; list.replaceChildren();
      for (const entry of visible) {
        const row = el('section',undefined,'maintenance-item'); row.dataset.personId = entry.person.id;
        row.append(el('h3',entry.person.name),el('p',`${entry.person.id} · ${mode === 'archive' ? '封存' : '刪除'}時間：${date(entry.time)}`,'form-note'));
        if (entry.person.archive?.reason) row.append(el('p',entry.person.archive.reason));
        const actions = el('div',undefined,'maintenance-item-actions');
        if (mode === 'archive') {
          actions.append(button('查看族譜',() => { ui.dialog.close(); document.getElementById('member-list-dialog')?.close(); dispatchEvent(new CustomEvent('familytreeselect',{ detail:{ id:entry.person.id,options:{ expandDetails:true } } })); }),
            button('解除封存',() => openLifecycle('unarchiveMember',entry.person.id)),button('移至回收區',() => openLifecycle('deleteMember',entry.person.id),'plain-button maintenance-danger'));
        } else {
          row.append(el('p',`${entry.person.relationships.length} 筆出向、${entry.incomingRelationships.length} 筆入向關係；${entry.groupReferences.length} 個排行群組。`,'form-note'));
          actions.append(button('預覽還原',() => openLifecycle('restoreMember',entry.person.id)));
        }
        row.append(actions); list.append(row);
      }
      if (!visible.length) list.append(el('p',keyword ? '沒有符合的成員。' : '目前沒有成員。','maintenance-empty'));
      ui.content.scrollTop = top;
    };
    search.addEventListener('input',draw); ui.actions.append(button('更新資料',async () => { try { await FamilyEditor.reload(); draw(); } catch(e) { ui.error.textContent = e.message; } }));
    const changed = () => draw(); window.addEventListener('familyappchange',changed);
    ui.dialog.addEventListener('close',() => { window.removeEventListener('familyappchange',changed); panels.delete(id); });
    panels.set(id,{ ...ui,search }); draw(); ui.open();
  }
  function openWorkbench() {
    const id = 'family-workbench-dialog';
    if (panels.get(id)?.dialog.isConnected) { panels.get(id).search.focus(); return; }
    const ui = modal('待整理資料',id);
    const search = el('input',undefined,'maintenance-search'); search.type = 'search'; search.placeholder = '搜尋成員、原因或來源'; search.setAttribute('aria-label','搜尋待整理資料');
    const filters = el('div',undefined,'maintenance-categories'); filters.setAttribute('role','group'); filters.setAttribute('aria-label','待整理分類');
    const count = el('p','','form-note'); count.setAttribute('role','status');
    const list = el('div',undefined,'maintenance-items'), categoryButtons = new Map(); let category = 'all';
    for (const [key,label] of [['all','全部'],...Object.entries(FamilyMaintenance.categories)]) {
      const control = button(label,() => { category = key; ui.content.scrollTop = 0; draw(); }); control.dataset.category = key; categoryButtons.set(key,{ control,label }); filters.append(control);
    }
    ui.content.append(el('p','依目前族譜整理需要確認的資料。疑似重複僅提供候選，請確認後再合併。','form-note'),search,filters,count,list);
    function launch(task,action) {
      const restoreFocus = () => { if (ui.dialog.isConnected) search.focus({ preventScroll:true }); };
      const before = new Set(document.querySelectorAll('dialog'));
      if (action === 'edit') window.editFamilyMember(task.ownerId);
      if (action === 'relative') window.openRelativePicker(task.ownerId);
      if (action === 'intermediate') window.addIntermediateMember(task.planId);
      if (action === 'location') window.FamilyLocationCorrection?.open(task.ownerId);
      if (action === 'merge') window.FamilyManagement.openMerge({ keepId:task.keepId,removeId:task.removeId });
      const child = [...document.querySelectorAll('dialog[open]')].find(dialog => dialog !== ui.dialog && (!before.has(dialog) || ['member-dialog','member-map-dialog'].includes(dialog.id)));
      child?.addEventListener('close',restoreFocus,{ once:true });
    }
    function draw() {
      const data = snapshot()?.data; if (!data) return;
      const top = ui.content.scrollTop, focusTask = document.activeElement?.closest('[data-task-id]')?.dataset.taskId;
      const result = FamilyMaintenance.tasks(data,{ locationState:window.FamilyMemberLocations?.state() });
      const keyword = FamilyMaintenance.normalize(search.value);
      const visible = result.items.filter(task => (category === 'all' || category === task.category)
        && FamilyMaintenance.normalize([task.title,task.reason,...task.personIds].join(' ')).includes(keyword));
      for (const [key,{ control,label }] of categoryButtons) { control.textContent = `${label}（${key === 'all' ? result.total : result.counts[key]}）`; control.setAttribute('aria-pressed',String(key === category)); }
      count.textContent = `共 ${result.total} 項待整理；顯示 ${visible.length} 項`; list.replaceChildren();
      for (const task of visible) {
        const row = el('section',undefined,'maintenance-item'); row.dataset.taskId = task.id; row.dataset.category = task.category;
        row.append(el('small',FamilyMaintenance.categories[task.category],'maintenance-category'),el('h3',task.title),el('p',task.reason));
        if (task.personIds.length === 1) {
          const person = data.people.find(p => p.id === task.personIds[0]);
          if (person && data.people.some(p => p.id !== person.id && FamilyMaintenance.normalize(p.name) === FamilyMaintenance.normalize(person.name)))
            row.append(el('p',`${person.id} · ${person.location || '所在地未填寫'}`,'form-note'));
        }
        if (task.locations) row.append(el('p',task.locations.map((location,index) => `${task.personIds[index]}：${location || '所在地未填寫'}`).join('；'),'form-note'));
        const actions = el('div',undefined,'maintenance-item-actions');
        const labels = { edit:'編輯成員',intermediate:'補登親屬',location:'修正地點',merge:'比較並合併' };
        actions.append(button(labels[task.action],() => launch(task,task.action)));
        if (task.action === 'edit') actions.append(button('新增親屬',() => launch(task,'relative')));
        if (task.action === 'intermediate') actions.append(button('忽略此待補項目',async () => {
          try { await FamilyEditor.ignoreIntermediate(task.planId); } catch(e) { ui.error.textContent = e.message; }
        }));
        row.append(actions); list.append(row);
      }
      if (!visible.length) list.append(el('p',keyword ? '沒有符合的待整理資料。' : '這個分類目前沒有待整理項目。','maintenance-empty'));
      ui.content.scrollTop = top;
      if (focusTask) (list.querySelector('[data-task-id="' + CSS.escape(focusTask) + '"] button') || search).focus({ preventScroll:true });
    }
    search.addEventListener('input',draw);
    ui.actions.append(button('更新資料',async () => { try { await FamilyEditor.reload(); ui.error.textContent = ''; } catch(e) { ui.error.textContent = e.message; } }));
    const changed = () => draw(); window.addEventListener('familyappchange',changed); window.addEventListener('familylocationstatus',changed);
    ui.dialog.addEventListener('close',() => { window.removeEventListener('familyappchange',changed); window.removeEventListener('familylocationstatus',changed); panels.delete(id); });
    panels.set(id,{ ...ui,search }); draw(); ui.open();
  }
  window.FamilyMaintenanceUI = { openLifecycle,openWorkbench,openArchived:() => library('archive'),openRecycle:() => library('recycle') };
  const list = document.querySelector('#member-list-dialog .member-list-sticky');
  const links = el('div',undefined,'maintenance-library-links');
  links.append(button('封存成員',() => library('archive')),button('回收區',() => library('recycle')),button('待整理資料',openWorkbench)); list.after(links);
})();
