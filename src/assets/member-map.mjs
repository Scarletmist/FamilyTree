import { openCorrection, configureCorrection, correction } from './location-correction.mjs';
import { mapIconButton, setMapIcon } from './map-icons.mjs';
import { mapSheet } from './map-sheet.mjs';
const Location = window.FamilyLocation;
const dialog = document.createElement('dialog');
dialog.id = 'member-map-dialog'; dialog.className = 'member-map-dialog';
dialog.setAttribute('aria-labelledby', 'member-map-title');
dialog.innerHTML = `<div class="dialog-header member-map-header"><button type="button" id="member-map-back" class="details-icon" hidden></button><h2 id="member-map-title">成員地圖</h2><button type="button" id="member-map-status" class="member-map-counts" aria-label="查看待定位成員"></button><button type="button" id="close-member-map" class="details-icon"></button></div>
  <div class="member-map-body"><div id="member-map-canvas" class="member-map-canvas" role="region" aria-label="成員所在地地圖"></div>
    <aside id="member-map-panel" class="member-map-panel" aria-label="所在地與成員"><button type="button" id="member-map-sheet-handle" class="member-map-sheet-handle" aria-label="調整清單高度，點擊切換高度，方向鍵展開或收合"></button>
      <section id="member-map-browse" class="member-map-panel-content"><div class="member-map-panel-heading"><h3 id="member-map-list-title">所在地</h3><p id="member-map-list-caption"></p></div><div class="member-map-panel-scroll" id="member-map-scroll"><input type="search" id="member-map-filter" class="member-map-filter" aria-label="尋找地點或成員" placeholder="尋找地點或成員" autocomplete="off" /><div id="member-map-list" aria-label="地圖成員清單"></div></div><footer class="member-map-panel-footer"><p class="member-map-legend"><span></span>手動修正位置</p></footer></section>
      <section id="location-correction-panel" class="member-map-panel-content" aria-label="修正成員地點" hidden></section>
    </aside><div id="member-map-person-summary" class="member-map-person-summary" role="region" aria-label="成員摘要" hidden></div><div id="member-map-feedback" class="member-map-feedback" hidden></div>
  </div>`;
document.body.append(dialog);
dialog.querySelectorAll('.member-map-panel, .member-map-person-summary, .member-map-feedback').forEach(node => node.classList.add('pigeon-drag-block'));
const get = id => dialog.querySelector('#' + id);
const canvas = get('member-map-canvas'), list = get('member-map-list'), scroll = get('member-map-scroll');
const browse = get('member-map-browse'), editor = get('location-correction-panel');
const status = get('member-map-status'), back = get('member-map-back'), filter = get('member-map-filter');
const summary = get('member-map-person-summary'), feedback = get('member-map-feedback');
setMapIcon(back, 'back', '返回成員地圖'); setMapIcon(get('close-member-map'), 'cancel', '關閉成員地圖');
let runtime = null, modulePromise = null, mapModule = null, focusKey = '', groups = [], errorMessage = '', session = 0;
let mapProps = {}, bottomInset = 0, viewRequest = null, viewToken = 0, savedBrowse = null, pendingView = false, regionKeys = null;
let opener = null, editorOpener = null, summaryOpener = null, feedbackPayload = null, undoing = false;
const editing = () => dialog.dataset.editing === 'true';
const sheet = mapSheet({ body:dialog.querySelector('.member-map-body'), panel:get('member-map-panel'), handle:get('member-map-sheet-handle'), editing,
  onInset:next => { bottomInset = next; dialog.querySelector('.member-map-body').style.setProperty('--map-bottom-inset', `${next}px`); if (runtime) runtime.update({ ...mapProps, bottomInset, viewRequest }); } });
function el(tag, text, className = '') { const node = document.createElement(tag); node.textContent = text; node.className = className; return node; }
function button(text, action, className = 'plain-button') { const node = el('button', text, className); node.type = 'button'; node.addEventListener('click', action); return node; }
function groupPeople(people) {
  const result = new Map();
  for (const person of people) {
    const position = Location.effective(person); if (!position) continue;
    const key = `${position.lat},${position.lon}`;
    if (!result.has(key)) result.set(key, { key, lat:position.lat, lon:position.lon, label:person.location, people:[] });
    result.get(key).people.push(person);
  }
  for (const group of result.values()) group.label = [...new Set(group.people.map(person => person.location))].join('、');
  return [...result.values()];
}
function backgroundMessage() {
  const state = window.FamilyMemberLocations?.state() || {};
  if (errorMessage) return errorMessage;
  if (!state.pending) return '公開所在地會依序補齊定位資訊。';
  if (!state.owner) return '由其他裝置處理背景定位。';
  if (state.kind === 'retry') return '查詢失敗，5 秒後重試。';
  if (state.kind === 'unsupported') return '此瀏覽器不支援背景查詢，請使用新版瀏覽器。';
  if (!navigator.onLine) return '等待網路恢復後繼續定位。';
  return state.kind === 'querying' ? `正在查詢「${state.query}」。` : '背景依序補齊中。';
}
function refreshStatus() {
  const people = FamilyApp.snapshot()?.data.people || [];
  const count = people.filter(person => Location.effective(person)).length;
  const pending = people.filter(person => Location.eligible(person) && !Location.effective(person)).length;
  status.textContent = `${count} 已定位 · ${pending} 待定位`;
  status.setAttribute('aria-label', `${count} 位成員已定位，${pending} 位待定位，查看待定位成員`);
  status.title = backgroundMessage();
  const note = get('member-map-background'); if (note) note.textContent = backgroundMessage();
  const takeover = get('member-map-takeover'); if (takeover) { const state = FamilyMemberLocations.state(); takeover.hidden = !state.pending || state.owner; }
}
function updateMap(props) { mapProps = props; runtime?.update({ ...mapProps, bottomInset, viewRequest }); }
function select(key) {
  pendingView = false; regionKeys = null; focusKey = key; viewRequest = null; summary.hidden = true;
  const query = filter.value.trim().toLocaleLowerCase(), chosen = groups.find(group => group.key === key);
  if (query && chosen && ![chosen.label, ...chosen.people.map(person => person.name)].some(value => value.toLocaleLowerCase().includes(query))) filter.value = '';
  sheet.set('medium');
  if (chosen && mapModule) {
    const zoom = Math.max(15, runtime?.snapshot()?.zoom || 15);
    viewRequest = { token:++viewToken, view:{ center:mapModule.centerForVisiblePoint([chosen.lat, chosen.lon], zoom, bottomInset), zoom } };
  }
  draw();
  [...list.querySelectorAll('[data-location-key]')].find(node => node.dataset.locationKey === key)?.scrollIntoView({ block:'nearest' });
}
function correctionButton(person) {
  const correct = mapIconButton('correct', `修正${person.name}的地點`); correct.dataset.correctPerson = person.id;
  correct.addEventListener('click', () => openCorrection(person.id)); return correct;
}
function personSummary(person, trigger) {
  summaryOpener = trigger; summary.replaceChildren(); summary.hidden = false;
  const close = mapIconButton('cancel', '關閉成員摘要'); close.addEventListener('click', () => { summary.hidden = true; summaryOpener?.focus({ preventScroll:true }); });
  const heading = el('div', '', 'member-map-popup-heading'); heading.append(el('h3', person.name), close);
  summary.append(heading, el('p', person.location), el('p', Location.overrideCurrent(person) ? '● 手動修正位置' : '自動定位', 'form-note'));
  const actions = el('div', '', 'member-map-summary-actions');
  const details = mapIconButton('edit', `查看${person.name}的詳細資料`); details.addEventListener('click', () => {
    dialog.close(); window.dispatchEvent(new CustomEvent('familytreeselect', { detail:{ id:person.id, options:{ expandDetails:true } } }));
  });
  actions.append(details, correctionButton(person)); summary.append(actions); close.focus({ preventScroll:true });
}
function drawPlace(group) {
  const section = el('section', '', 'member-map-place'); section.dataset.locationKey = group.key;
  section.classList.toggle('is-selected', focusKey === group.key);
  const heading = button('', () => select(group.key), 'member-map-place-heading'); heading.setAttribute('aria-pressed', String(focusKey === group.key));
  heading.append(el('span', group.label), el('small', `${group.people.length} 位`)); section.append(heading);
  for (const person of group.people) {
    const row = el('div', '', 'member-map-member');
    const name = button(person.name, () => personSummary(person, name), 'member-map-person'); name.dataset.mapPerson = person.id;
    if (Location.overrideCurrent(person)) { name.dataset.locationManual = 'true'; name.title = `${person.name} · 已手動修正地點`; name.setAttribute('aria-label', name.title); }
    row.append(name, correctionButton(person)); section.append(row);
  }
  return section;
}
function drawPending(people) {
  const pending = people.filter(person => Location.eligible(person) && !Location.effective(person));
  if (!pending.length) list.append(el('p', '所有公開所在地皆已定位。', 'form-note'));
  for (const person of pending) {
    const row = el('div', '', 'member-map-unlocated');
    const reason = Location.current(person) ? ({ not_found:'查無地點', ambiguous:'同名地點，需要確認' })[person.geocode.status] : '背景依序查詢中';
    const label = el('div', '', 'member-map-pending-label'); label.append(el('strong', person.name), el('small', `${person.location} · ${reason || '待定位'}`));
    row.append(label, correctionButton(person));
    if (Location.current(person)) {
      const retry = mapIconButton('retry', `重新查詢${person.name}的所在地`);
      retry.addEventListener('click', async () => { retry.disabled = true; try { await FamilyMemberLocations.retry(person.id); } catch (error) { errorMessage = error.message; refreshStatus(); } finally { retry.disabled = false; } }); row.append(retry);
    }
    list.append(row);
  }
  const note = el('p', backgroundMessage(), 'form-note'); note.id = 'member-map-background'; note.setAttribute('role', 'status'); list.append(note);
  const takeover = mapIconButton('takeover', '由此裝置接手定位'); takeover.id = 'member-map-takeover';
  takeover.addEventListener('click', async () => { takeover.disabled = true; try { await FamilyMemberLocations.takeOver(); } catch (error) { errorMessage = error.message; refreshStatus(); } finally { takeover.disabled = false; } }); list.append(takeover);
}
function drawPrivate(people) {
  const excluded = people.filter(person => person.location.trim() && !Location.eligible(person)); if (!excluded.length) return;
  const details = el('details', '', 'member-map-private'); details.append(el('summary', `${excluded.length} 位成員不在地圖顯示`));
  for (const person of excluded) {
    const row = el('div', '', 'member-map-unlocated'); row.append(el('span', `${person.name} · 隱私排除`));
    const edit = mapIconButton('edit', `編輯${person.name}`); edit.addEventListener('click', () => { dialog.close(); window.editFamilyMember?.(person.id); }); row.append(edit); details.append(row);
  }
  list.append(details);
}
function drawList(people) {
  const oldScroll = scroll.scrollTop; list.replaceChildren(); filter.hidden = pendingView;
  get('member-map-list-title').textContent = pendingView ? '尚未定位' : regionKeys ? '這個區域' : '所在地';
  const visible = regionKeys ? groups.filter(group => regionKeys.includes(group.key)) : groups;
  get('member-map-list-caption').textContent = pendingView ? '確認地點後即可顯示在地圖' : `${visible.length} 個地點 · ${visible.reduce((n, group) => n + group.people.length, 0)} 位成員`;
  if (pendingView) {
    list.append(button('返回所有所在地', () => { pendingView = false; draw(); }, 'member-map-list-link')); drawPending(people);
  } else {
    if (regionKeys) list.append(button('顯示所有所在地', () => { regionKeys = null; draw(); }, 'member-map-list-link'));
    const query = filter.value.trim().toLocaleLowerCase();
    const matches = visible.filter(group => [group.label, ...group.people.map(person => person.name)].some(value => value.toLocaleLowerCase().includes(query)));
    for (const group of matches) list.append(drawPlace(group));
    if (!matches.length) list.append(el('p', query ? '沒有符合的地點或成員。' : '尚無可顯示的位置。', 'form-note'));
    const pending = people.filter(person => Location.eligible(person) && !Location.effective(person)).length;
    list.append(button(`尚未定位　${pending} 位 ›`, () => { pendingView = true; regionKeys = null; sheet.set('medium'); draw(); }, 'member-map-list-link'));
  }
  drawPrivate(people); scroll.scrollTop = oldScroll;
}
function draw() {
  if (!dialog.open) return;
  const people = FamilyApp.snapshot()?.data.people || []; groups = groupPeople(people);
  if (!editing()) {
    updateMap({ groups, focusKey:focusKey || groups.map(group => group.key).join('|'), selectedKey:focusKey, onSelect:select,
      onCluster:keys => { regionKeys = keys; pendingView = false; filter.value = ''; summary.hidden = true; sheet.set('medium'); drawList(FamilyApp.snapshot().data.people); } });
    drawList(people);
  }
  refreshStatus();
}
async function open(personId) {
  if (editing()) return false;
  if (!dialog.open) {
    opener = document.activeElement; ++session; dialog.showModal(); summary.hidden = feedback.hidden = true; feedbackPayload = null;
    pendingView = false; regionKeys = null; filter.value = ''; scroll.scrollTop = 0; viewRequest = null; sheet.set('medium');
  }
  groups = groupPeople(FamilyApp.snapshot()?.data.people || []);
  focusKey = groups.find(group => group.people.some(person => person.id === personId))?.key || '';
  draw(); const ticket = session;
  if (!runtime) {
    canvas.textContent = '載入地圖中…';
    modulePromise ||= import('./vendor/pigeon-map.js').catch(error => { modulePromise = null; throw error; });
    try {
      mapModule = await modulePromise;
      if (!dialog.open || ticket !== session) return false;
      if (!runtime) { canvas.replaceChildren(); runtime = mapModule.mount(canvas); }
      errorMessage = ''; draw();
    } catch { errorMessage = '地圖載入失敗，關閉後重開即可重試'; canvas.textContent = errorMessage; refreshStatus(); }
  }
  return dialog.open && ticket === session;
}
function restoreFocus(node) {
  if (node?.isConnected && !node.closest('[hidden]')) node.focus({ preventScroll:true });
  else if (node?.dataset.locationPerson) [...document.querySelectorAll('[data-location-person]')].find(button => button.dataset.locationPerson === node.dataset.locationPerson)?.focus({ preventScroll:true });
  else if (node?.dataset.correctPerson) [...list.querySelectorAll('[data-correct-person]')].find(button => button.dataset.correctPerson === node.dataset.correctPerson)?.focus({ preventScroll:true });
}
function showFeedback(result) {
  feedback.replaceChildren(); feedback.hidden = false; feedbackPayload = result.payload;
  const message = el('span', result.message); message.setAttribute('role', 'status');
  const undo = button('復原', async () => {
    if (!feedbackPayload || undoing) return; undoing = true; undo.disabled = true;
    try {
      const current = FamilyApp.snapshot();
      const metadataOnly = current.undoLabel === feedbackPayload.undoLabel && FamilyModel.sameJsonData(Location.content(current.data), Location.content(feedbackPayload.data));
      const restored = await FamilyEditor.undo(metadataOnly ? current.version : feedbackPayload.version);
      if (!restored) throw new Error('無法復原此位置修改；資料可能已變更，請重新開啟地圖。');
      feedbackPayload = null; message.textContent = '已復原位置修改'; undo.remove();
    } catch (error) { message.textContent = error.message; } finally { undoing = false; undo.disabled = false; }
  });
  const close = mapIconButton('cancel', '關閉提示'); close.addEventListener('click', () => { feedback.hidden = true; }); feedback.append(message, undo, close);
}
configureCorrection({ editor, editing, updateMap, view:() => runtime?.snapshot(), clearViewRequest:() => { viewRequest = null; },
  focusPoint:point => { if (mapModule) { const zoom = Math.max(15, runtime?.snapshot()?.zoom || 15); viewRequest = { token:++viewToken, view:{ center:mapModule.centerForVisiblePoint(point, zoom, bottomInset), zoom } }; } },
  focusBack:() => back.focus({ preventScroll:true }),
  busy:value => {
    // Preserve the map's own disabled zoom bounds; saving only locks its surface.
    canvas.inert = editor.inert = value;
    editor.querySelectorAll('button, input').forEach(node => { node.disabled = value; });
    back.disabled = get('close-member-map').disabled = get('member-map-sheet-handle').disabled = value;
  },
  async enter(record) {
    editorOpener = document.activeElement;
    if (!dialog.open && !await open(record.id)) return false;
    if (!dialog.open) return false;
    savedBrowse = { view:runtime?.snapshot(), focusKey, pendingView, regionKeys, scroll:scroll.scrollTop, sheet:sheet.state };
    summary.hidden = feedback.hidden = true; dialog.dataset.editing = 'true'; browse.hidden = true; editor.hidden = false;
    back.hidden = false; status.hidden = true; get('member-map-title').textContent = '修正地點'; sheet.set('medium');
    const position = Location.effective(record), zoom = position ? Math.max(15, savedBrowse.view?.zoom || 15) : 7;
    const point = position ? [position.lat, position.lon] : [23.7, 121];
    viewRequest = mapModule ? { token:++viewToken, view:{ center:mapModule.centerForVisiblePoint(point, zoom, bottomInset), zoom } } : null;
    return true;
  },
  finish(result) {
    delete dialog.dataset.editing; editor.hidden = true; browse.hidden = false; back.hidden = true; status.hidden = false; get('member-map-title').textContent = '成員地圖';
    if (savedBrowse) {
      ({ focusKey, pendingView, regionKeys } = savedBrowse); sheet.set(savedBrowse.sheet);
      if (savedBrowse.view) viewRequest = { token:++viewToken, view:savedBrowse.view };
    }
    if (result) { groups = groupPeople(FamilyApp.snapshot().data.people); focusKey = groups.find(group => group.people.some(person => person.id === result.personId))?.key || focusKey; }
    draw(); if (savedBrowse) scroll.scrollTop = savedBrowse.scroll; restoreFocus(editorOpener); savedBrowse = null;
    if (result) showFeedback(result);
  }
});
back.addEventListener('click', () => correction.back());
get('close-member-map').addEventListener('click', () => { if (!correction.busy()) { dialog.close(); restoreFocus(opener); } });
dialog.addEventListener('cancel', event => {
  if (correction.busy()) { event.preventDefault(); return; }
  if (!summary.hidden) { event.preventDefault(); summary.hidden = true; restoreFocus(summaryOpener); }
  else if (editing()) { event.preventDefault(); correction.back(); }
});
dialog.addEventListener('close', () => {
  ++session; correction.close(); sheet.close(); runtime?.destroy(); runtime = null; canvas.replaceChildren();
  delete dialog.dataset.editing; editor.hidden = true; browse.hidden = false; back.hidden = true; status.hidden = false; get('member-map-title').textContent = '成員地圖'; savedBrowse = null;
  restoreFocus(opener);
});
filter.addEventListener('input', () => drawList(FamilyApp.snapshot().data.people));
status.addEventListener('click', () => { pendingView = !pendingView; regionKeys = null; sheet.set('medium'); draw(); });
document.getElementById('show-member-map').addEventListener('click', () => open());
window.addEventListener('familyappchange', () => { summary.hidden = true; draw(); });
window.addEventListener('familylocationstatus', () => { if (dialog.open) refreshStatus(); });
window.FamilyMemberMap = { open };
