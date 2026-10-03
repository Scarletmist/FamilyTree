import { openCorrection } from './location-correction.mjs';
import { mapIconButton, setMapIcon } from './map-icons.mjs';
const Location = window.FamilyLocation;
const dialog = document.createElement('dialog');
dialog.id = 'member-map-dialog'; dialog.className = 'member-map-dialog';
dialog.setAttribute('aria-labelledby', 'member-map-title');
dialog.innerHTML = `<div class="dialog-header"><h2 id="member-map-title">成員地圖</h2><button type="button" id="close-member-map" class="details-icon" aria-label="關閉成員地圖" title="關閉成員地圖"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M18 6 6 18 M6 6l12 12" /></svg></button></div>
  <div class="member-map-toolbar"><p id="member-map-status" role="status" aria-live="polite"></p><button type="button" id="member-map-takeover" class="plain-button" hidden>由此裝置接手定位</button></div>
  <div class="member-map-body"><div id="member-map-canvas" class="member-map-canvas" role="region" aria-label="成員所在地地圖" tabindex="0"></div><div id="member-map-list" class="member-map-list" aria-label="地圖成員清單"></div></div>`;
document.body.append(dialog);
let runtime = null, loading = false, focusKey = '', groups = [], errorMessage = '';
const canvas = dialog.querySelector('#member-map-canvas');
const list = dialog.querySelector('#member-map-list');
const status = dialog.querySelector('#member-map-status');
const takeover = dialog.querySelector('#member-map-takeover');
setMapIcon(takeover, 'takeover', '由此裝置接手定位');
function el(tag, text, className = '') { const node = document.createElement(tag); node.textContent = text; node.className = className; return node; }
function groupPeople(people) {
  const result = new Map();
  for (const person of people) {
    const g = Location.effective(person);
    if (!g) continue;
    const key = `${g.lat},${g.lon}`;
    if (!result.has(key)) result.set(key, { key, lat: g.lat, lon: g.lon, label: person.location, people: [] });
    result.get(key).people.push(person);
  }
  return [...result.values()];
}
function refreshStatus() {
  const state = window.FamilyMemberLocations?.state() || {};
  const count = groups.reduce((n, group) => n + group.people.length, 0);
  let message = `${count} 位成員已定位，共 ${groups.length} 個地點`;
  if (state.pending) {
    message += `；${state.pending} 位待定位`;
    if (!state.owner) message += '，由其他裝置處理';
    else if (state.kind === 'retry') message += '，查詢失敗，5 秒後重試';
    else if (state.kind === 'unsupported') message += '，此瀏覽器不支援背景查詢，請使用新版瀏覽器';
    else if (!navigator.onLine) message += '，等待網路恢復';
    else if (state.kind === 'querying') message += '，正在查詢「' + state.query + '」';
    else message += '，背景依序補齊中';
  }
  if (errorMessage) message += '；' + errorMessage;
  status.textContent = message;
  takeover.hidden = !state.pending || state.owner;
}
function draw() {
  if (!dialog.open) return;
  const people = FamilyApp.snapshot()?.data.people || [];
  groups = groupPeople(people);
  const signature = groups.map(g => g.key).join('|');
  runtime?.update({ groups, focusKey: focusKey || signature, onSelect: key => { focusKey = key; draw(); list.querySelector(`[data-location-key="${key}"]`)?.scrollIntoView({ block: 'nearest' }); } });
  list.replaceChildren();
  for (const group of groups) {
    const section = el('section', '', 'member-map-place'); section.dataset.locationKey = group.key;
    const heading = el('button', group.label + (group.people.length > 1 ? `（${group.people.length} 人）` : ''), 'plain-button'); heading.type = 'button';
    heading.addEventListener('click', () => { focusKey = group.key; draw(); }); section.append(heading);
    for (const person of group.people) {
      const row = el('div', '', 'member-map-member');
      const button = el('button', person.name, 'member-map-person'); button.type = 'button';
      button.addEventListener('click', () => { dialog.close(); window.dispatchEvent(new CustomEvent('familytreeselect', { detail: { id: person.id } })); });
      row.append(button);
      if (Location.overrideCurrent(person)) row.append(el('span', '已手動修正', 'location-manual-badge'));
      const correct = mapIconButton('correct', `修正${person.name}的地點`); correct.dataset.correctPerson = person.id;
      correct.addEventListener('click', () => openCorrection(person.id)); row.append(correct);
      section.append(row);
    }
    list.append(section);
  }
  const unlocated = people.filter(p => p.location.trim() && !Location.effective(p));
  if (!groups.length) list.append(el('p', '尚無可顯示的位置。已填寫的公開所在地會在背景依序查詢。', 'form-note'));
  for (const person of unlocated) {
    const row = el('div', '', 'member-map-unlocated');
    const label = !Location.eligible(person) ? '隱私排除' : Location.current(person) ? ({ not_found: '查無地點', ambiguous: '同名地點，請補充所在地' })[person.geocode.status] : '待定位';
    row.append(el('span', `${person.name} · ${label}`));
    if (Location.eligible(person)) {
      const correct = mapIconButton('correct', `修正${person.name}的地點`); correct.dataset.correctPerson = person.id;
      correct.addEventListener('click', () => openCorrection(person.id)); row.append(correct);
    }
    if (Location.eligible(person) && Location.current(person)) {
      const retry = mapIconButton('retry', '重新查詢');
      retry.addEventListener('click', async () => { retry.disabled = true; try { await FamilyMemberLocations.retry(person.id); } catch (error) { errorMessage = error.message; refreshStatus(); } finally { retry.disabled = false; } });
      row.append(retry);
    }
    const edit = mapIconButton('edit', `編輯${person.name}`);
    edit.addEventListener('click', () => { dialog.close(); window.editFamilyMember?.(person.id); }); row.append(edit);
    list.append(row);
  }
  refreshStatus();
}
async function open(personId) {
  if (!dialog.open) dialog.showModal();
  groups = groupPeople(FamilyApp.snapshot()?.data.people || []);
  focusKey = groups.find(group => group.people.some(p => p.id === personId))?.key || '';
  draw();
  if (!runtime && !loading) {
    loading = true; canvas.textContent = '載入地圖中…';
    try { const module = await import('./vendor/pigeon-map.js'); canvas.replaceChildren(); runtime = module.mount(canvas); errorMessage = ''; draw(); }
    catch { loading = false; errorMessage = '地圖載入失敗，關閉後重開即可重試'; canvas.textContent = errorMessage; refreshStatus(); }
    finally { loading = false; }
  }
}
dialog.querySelector('#close-member-map').addEventListener('click', () => dialog.close());
dialog.addEventListener('close', () => { runtime?.destroy(); runtime = null; canvas.replaceChildren(); });
document.getElementById('show-member-map').addEventListener('click', () => open());
takeover.addEventListener('click', async () => { takeover.disabled = true; try { await FamilyMemberLocations.takeOver(); } catch (error) { errorMessage = error.message; refreshStatus(); } finally { takeover.disabled = false; } });
window.addEventListener('familyappchange', draw);
window.addEventListener('familylocationstatus', () => { if (dialog.open) refreshStatus(); });
window.FamilyMemberMap = { open };
