(function () {
  'use strict';
  const Model = window.FamilyModel;
  const editor = () => window.FamilyEditor;
  const el = (tag, text, cls) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (cls) n.className = cls; return n; };
  const button = (text, action, cls = 'plain-button') => { const b = el('button', text, cls); b.type = 'button'; b.addEventListener('click', action); return b; };
  const iconButton = (label, action, path = 'M18 6 6 18 M6 6l12 12') => {
    const b = button('', action, 'details-icon'); b.setAttribute('aria-label', label); b.title = label;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('width', '18'); svg.setAttribute('height', '18');
    svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '1.8');
    svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
    const shape = document.createElementNS('http://www.w3.org/2000/svg', 'path'); shape.setAttribute('d', path); svg.appendChild(shape); b.appendChild(svg); return b;
  };
  function modal(title) {
    const dialog = el('dialog', undefined, 'family-management-dialog');
    const header = el('div', undefined, 'dialog-header'), heading = el('h2', title);
    heading.title = title;
    heading.id = 'management-title-' + crypto.randomUUID(); dialog.setAttribute('aria-labelledby', heading.id);
    const close = iconButton('關閉' + title, () => { if (!dialog.dataset.busy) dialog.close(); });
    header.append(heading, close);
    const content = el('div', undefined, 'dialog-scroll'), actions = el('div', undefined, 'form-actions');
    const error = el('p', '', 'form-error'); error.role = 'alert'; error.tabIndex = -1;
    dialog.append(header, content, error, actions);
    dialog.addEventListener('cancel', event => { if (dialog.dataset.busy) event.preventDefault(); });
    dialog.addEventListener('close', () => dialog.remove());
    document.body.append(dialog);
    return { dialog, content, actions, error, open: () => dialog.showModal() };
  }
  function field(parent, title, input) { const label = el('label', title, 'management-field'); input.setAttribute('aria-label', title); label.append(input); parent.append(label); return input; }
  function select(options) { const input = el('select'); options.forEach(([value, title]) => { const o = el('option', title); o.value = value; input.append(o); }); return input; }
  async function save(ui, body) {
    ui.error.textContent = ''; ui.dialog.dataset.busy = 'true';
    const controls = [...ui.dialog.querySelectorAll('button,input,select,textarea')]; controls.forEach(c => c.disabled = true);
    try { await editor().manage(body); ui.dialog.close(); }
    catch (error) { ui.error.textContent = error.message; ui.error.focus(); }
    finally { delete ui.dialog.dataset.busy; controls.forEach(c => c.disabled = false); }
  }
  window.renderFamilyDifferences = (container, before, after) => {
    container.querySelector('.family-differences')?.remove();
    const section = el('details', undefined, 'family-differences'); section.open = true;
    const lines = Model.dataDifferences(before, after);
    section.append(el('summary', `內容差異（目前版本 → 新版本，共 ${lines.length} 項）`));
    const list = el('ul');
    for (const text of lines) list.append(el('li', text));
    section.append(lines.length ? list : el('p', '成員與關係內容相同。'));
    container.append(section);
  };
  window.openRelativePicker = id => {
    const person = editor().snapshot()?.data.people.find(p => p.id === id); if (!person) return;
    const ui = modal('新增' + person.name + '的親屬');
    ui.content.append(el('p', '選擇要新增的人與此成員的關係，下一步會帶入表單。'));
    const choices = el('div', undefined, 'management-choices');
    for (const [label, type] of [['子女','parent'],['父母','child'],['配偶','spouse'],['手足','sibling'],['契手足','swornSibling'],['祖父母','grandchild'],['孫子女','grandparent'],['師父','student'],['徒弟','teacher'],['同門','fellowDisciple']]) {
      choices.append(button('新增' + label, () => { ui.dialog.close(); editor().addRelative(id, type); }));
    }
    ui.content.append(choices); ui.open();
  };
  function openGroups() {
    const snapshot = editor().snapshot(); if (!snapshot) return;
    const ui = modal('排行群組'), data = snapshot.data;
    let groups = JSON.parse(JSON.stringify(data.rankGroups || [])), selectedId = '', memberInputs = [];
    const choose = field(ui.content, '編輯群組', select([['','新增群組'], ...groups.map(g => [g.id, g.name])]));
    const name = field(ui.content, '群組名稱', el('input')); name.maxLength = 80;
    const type = field(ui.content, '排行類型', select([['sibling','家庭手足'],['swornSibling','契手足'],['fellowDisciple','師門']]));
    const anchor = field(ui.content, '所屬父母或師父（選填，供子女／徒弟排行顯示）', select([['','未指定'], ...data.people.map(p => [p.id,p.name])]));
    ui.content.append(el('p', '勾選所屬成員，排行未知可留空。群組不會自動建立親屬或師徒關係；成員有群組時，稱謂使用群組排行。同一對成員有多個群組時，請在關係表單指定使用哪一組。', 'form-note'));
    const search = field(ui.content, '搜尋成員', el('input')); search.type = 'search';
    const members = el('div', undefined, 'rank-members'); ui.content.append(members);
    function draw() {
      const group = groups.find(g => g.id === selectedId);
      name.value = group?.name || ''; type.value = group?.type || 'sibling'; anchor.value = group?.anchorId || '';
      memberInputs = []; members.replaceChildren(); search.value = '';
      for (const p of data.people) {
        const row = el('div', undefined, 'rank-member'), label = el('label');
        const check = el('input'); check.type = 'checkbox'; check.checked = !!group?.members.some(m => m.personId === p.id);
        label.append(check, document.createTextNode(p.name + (p.location ? '（' + p.location + '）' : '')));
        const order = el('input'); order.type = 'number'; order.min = '1'; order.max = '999'; order.step = '1'; order.placeholder = '排行未知';
        order.setAttribute('aria-label', p.name + '的群組排行'); order.value = group?.members.find(m => m.personId === p.id)?.order ?? ''; order.disabled = !check.checked;
        check.addEventListener('change', () => { order.disabled = !check.checked; });
        row.append(label, order); members.append(row); memberInputs.push({ personId:p.id, check, order, row, name:p.name });
      }
    }
    search.addEventListener('input', () => memberInputs.forEach(m => m.row.hidden = !m.name.includes(search.value.trim())));
    choose.addEventListener('change', () => { selectedId = choose.value; draw(); });
    ui.actions.append(button('儲存群組', () => {
      const group = { id:selectedId || 'g-' + crypto.randomUUID(), name:name.value.trim(), type:type.value, ...(anchor.value ? {anchorId:anchor.value} : {}),
        members:memberInputs.filter(m => m.check.checked).map(m => ({personId:m.personId,order:m.order.value === '' ? null : Number(m.order.value)})) };
      const next = [...groups.filter(g => g.id !== group.id), group];
      try { Model.manageFamily(data, {action:'rankGroups',rankGroups:next}); }
      catch (error) { ui.error.textContent = error.message; ui.error.focus(); return; }
      save(ui, {action:'rankGroups',rankGroups:next,version:snapshot.version});
    }, 'primary-button'));
    ui.actions.append(button('移除此群組', () => {
      if (!selectedId) { ui.error.textContent = '請先選擇既有群組。'; return; }
      const next = groups.filter(g => g.id !== selectedId);
      try { Model.manageFamily(data, {action:'rankGroups',rankGroups:next}); }
      catch (error) { ui.error.textContent = error.message; return; }
      save(ui, {action:'rankGroups',rankGroups:next,version:snapshot.version});
    }));
    draw(); ui.open();
  }
  function openMerge() {
    const snapshot = editor().snapshot(); if (!snapshot) return;
    const data = snapshot.data, ui = modal('合併重複成員');
    ui.content.append(el('p', '選擇保留與併入的成員，逐欄確認資料，再預覽所有關係變更。相同姓名不會自動合併。'));
    const options = [['','請選擇成員'], ...data.people.map(p => [p.id, `${p.name}（${p.location || '所在地未填'}・${p.id}）`])];
    const keep = field(ui.content, '保留的成員', select(options)), remove = field(ui.content, '併入後移除的成員', select(options));
    const fields = el('div'), preview = el('div'); ui.content.append(fields, preview);
    let choices = new Map(), staged = null;
    const commit = button('確認合併', () => { if (staged) save(ui, {...staged,version:snapshot.version}); }, 'primary-button'); commit.disabled = true;
    function resetPreview() { staged = null; commit.disabled = true; preview.replaceChildren(); }
    function draw() {
      resetPreview(); fields.replaceChildren(); choices = new Map(); ui.error.textContent = '';
      const a = data.people.find(p => p.id === keep.value), b = data.people.find(p => p.id === remove.value);
      if (!a || !b || a.id === b.id) return;
      for (const [key,label] of Object.entries({name:'姓名',gender:'性別',location:'所在地',position:'職位',notes:'備註',siblingOrder:'手足排行',discipleOrder:'師門排行'})) {
        const show = v => v === '' || v == null ? '未填寫' : key === 'gender' ? ({M:'男',F:'女',U:'未填寫'})[v] : String(v);
        const choice = field(fields, label, select([['keep',`${a.name}：${show(a[key])}`],['remove',`${b.name}：${show(b[key])}`]]));
        choice.addEventListener('change', resetPreview); choices.set(key, choice);
      }
    }
    keep.addEventListener('change', draw); remove.addEventListener('change', draw);
    ui.actions.append(button('預覽合併', () => {
      resetPreview(); ui.error.textContent = '';
      try {
        const a = data.people.find(p => p.id === keep.value), b = data.people.find(p => p.id === remove.value);
        if (!a || !b || a.id === b.id) throw new Error('請選擇兩位不同成員。');
        const values = {}; choices.forEach((input,key) => { values[key] = (input.value === 'keep' ? a : b)[key] ?? (['notes','position','location'].includes(key) ? '' : null); });
        const candidate = {action:'merge',keepId:a.id,removeId:b.id,fields:values};
        const result = Model.manageFamily(data,candidate);
        window.renderFamilyDifferences(preview,data,result); staged = candidate; commit.disabled = false;
      } catch (error) { ui.error.textContent = error.message; }
    }),commit); ui.open();
  }
  const toolbar = el('div', undefined, 'management-toolbar');
  toolbar.append(button('排行群組', openGroups),button('合併重複成員', openMerge));
  const undoStatus = el('span'); undoStatus.role = 'status';
  const undo = button('復原上一項修改', async () => {
    undo.disabled = true; undoStatus.textContent = '';
    try { const label = editor().snapshot()?.undoLabel; const ok = await editor().undo(); undoStatus.textContent = ok ? '已復原「' + label + '」。' : '未能復原，請查看畫面提示。'; }
    catch (error) { undoStatus.textContent = error.message; }
    finally { refreshUndo(); }
  });
  toolbar.append(undo,undoStatus);
  function refreshUndo() {
    const label = editor().snapshot()?.undoLabel;
    undo.disabled = !label;
    undo.textContent = label ? '復原：' + label : '目前沒有可復原的修改';
  }
  window.addEventListener('familyintermediatechange', refreshUndo); refreshUndo();
  document.querySelector('#member-list-dialog .member-list-sticky').append(toolbar);
  const duplicate = el('p', '', 'form-note'); duplicate.id = 'member-duplicate-hint'; duplicate.role = 'status'; duplicate.hidden = true;
  const name = document.getElementById('member-name'); name.parentElement.append(duplicate);
  name.addEventListener('input', () => {
    const matches = editor().snapshot()?.data.people.filter(p => p.id !== editor().editingId() && p.name.trim() === name.value.trim()) || [];
    duplicate.hidden = !matches.length;
    duplicate.textContent = matches.length ? `已有 ${matches.length} 位同名成員：${matches.map(p => p.name + '（' + (p.location || '所在地未填寫') + '）').join('、')}。請確認是否為同一人；可從成員清單合併重複資料。` : '';
  });
  document.getElementById('member-form').addEventListener('reset', () => { duplicate.textContent = ''; duplicate.hidden = true; });
})();
