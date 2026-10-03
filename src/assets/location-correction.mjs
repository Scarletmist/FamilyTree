import { setMapIcon } from './map-icons.mjs';
const Location = window.FamilyLocation;
const dialog = document.createElement('dialog');
dialog.id = 'location-correction-dialog';
dialog.className = 'member-map-dialog location-correction-dialog';
dialog.setAttribute('aria-labelledby', 'location-correction-title');
dialog.innerHTML = `<div class="dialog-header"><h2 id="location-correction-title">修正地點</h2><button type="button" id="close-location-correction" class="details-icon" aria-label="關閉地點修正" title="關閉地點修正"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M18 6 6 18 M6 6l12 12" /></svg></button></div>
  <div class="location-correction-body">
    <div id="location-correction-canvas" class="member-map-canvas" role="region" aria-label="地點修正預覽地圖"></div>
    <div class="location-correction-sidebar">
      <p id="location-correction-person"></p><p id="location-correction-current" class="form-note"></p>
      <div class="location-correction-modes" aria-label="修正方式"><button type="button" id="location-mode-search" class="plain-button" aria-pressed="true">搜尋地點</button><button type="button" id="location-mode-map" class="plain-button" aria-pressed="false">在地圖上指定</button></div>
      <div id="location-search-section"><form id="location-search-form"><label for="location-search-query">補充地名或縣市</label><div class="location-search-input"><input id="location-search-query" maxlength="120" required autocomplete="off" /><button type="submit" class="plain-button" id="location-search-submit">查詢</button></div></form><p id="location-search-status" role="status" aria-live="polite"></p><div id="location-search-results" aria-label="候選地點"></div></div>
      <p id="location-map-help" class="form-note" hidden>移動地圖，將正確的公開地點對準中央準星，再按右下角的勾選圖示儲存。原所在地文字會保留。</p>
      <p id="location-selection-status" role="status" aria-live="polite">請搜尋並選擇地點，或在地圖上指定。</p>
      <label id="location-apply-group" class="location-apply-group" hidden><input type="checkbox" id="location-apply-related" /><span id="location-apply-label"></span></label>
      <p id="location-apply-note" class="form-note" hidden></p>
    </div>
  </div>
  <div class="form-actions location-correction-actions"><p id="location-correction-error" class="form-error" role="alert"></p><button type="button" id="location-restore-auto" class="plain-button" hidden>恢復自動定位</button><button type="button" id="cancel-location-correction" class="plain-button">取消</button><button type="button" id="save-location-correction" class="primary-button" disabled>使用此位置</button></div>`;
document.body.append(dialog);
const get = id => dialog.querySelector('#' + id);
for (const [id, icon, label] of [
  ['location-mode-search', 'search', '搜尋地點'], ['location-mode-map', 'pick', '在地圖上指定'],
  ['location-search-submit', 'search', '查詢'], ['location-restore-auto', 'retry', '恢復自動定位'],
  ['cancel-location-correction', 'cancel', '取消'], ['save-location-correction', 'save', '使用此位置']
]) setMapIcon(get(id), icon, label);
const canvas = get('location-correction-canvas');
const input = get('location-search-query');
const results = get('location-search-results');
const error = get('location-correction-error');
const searchStatus = get('location-search-status');
const selectionStatus = get('location-selection-status');
const saveButton = get('save-location-correction');
let person = null, mode = 'search', selected = null, choices = [], runtime = null, controller = null;
let relatedMembers = [];
let center = [23.7, 121], saving = false, session = 0, opener = null, focusKey = '';
function text(tag, value, className = '') { const node = document.createElement(tag); node.textContent = value; node.className = className; return node; }
function cancelSearch() { controller?.abort(); controller = null; get('location-search-submit').disabled = saving; }
function selectedChanged() {
  selectionStatus.textContent = selected ? (mode === 'map' ? '中央準星為修正位置，按勾選圖示儲存。' : '已選擇：' + selected.displayName) : '請搜尋並選擇地點，或在地圖上指定。';
  saveButton.disabled = saving || !selected;
}
function drawChoices() {
  results.replaceChildren();
  choices.forEach((choice, index) => {
    const button = text('button', '', 'location-candidate plain-button'); button.type = 'button';
    button.dataset.candidate = String(index);
    button.setAttribute('aria-pressed', String(selected === choice));
    button.append(text('strong', choice.name || choice.displayName.split(',')[0]), text('span', choice.displayName));
    button.addEventListener('click', () => { selected = choice; focusKey = 'candidate-' + index; drawChoices(); selectedChanged(); drawMap(); });
    results.append(button);
  });
}
const centerChanged = next => {
  center = next;
  if (mode === 'map') {
    selected = { lat: next[0], lon: next[1], displayName: '地圖指定位置' };
    selectedChanged();
  }
};
function drawMap() {
  const initial = Location.effective(person);
  const groups = mode === 'map' ? [] : choices.length ? choices.map((choice, index) => ({ key: 'candidate-' + index,
    lat: choice.lat, lon: choice.lon, label: choice.name || choice.displayName, people: [{ name: choice.displayName }] }))
    : initial ? [{ key: 'current', lat: initial.lat, lon: initial.lon, label: person.location, people: [{ name: person.name }] }] : [];
  runtime?.update({ groups, clustering:false, focusKey, initialCenter: center, initialZoom: initial ? 15 : 7, picking: mode === 'map', onCenterChange: centerChanged,
    onSelect: key => { const choice = choices[Number(key.replace('candidate-', ''))]; if (choice) { selected = choice; focusKey = key; drawChoices(); selectedChanged(); drawMap(); } } });
}
function setMode(next) {
  cancelSearch(); mode = next; selected = null; error.textContent = ''; searchStatus.textContent = '';
  get('location-mode-search').setAttribute('aria-pressed', String(mode === 'search'));
  get('location-mode-map').setAttribute('aria-pressed', String(mode === 'map'));
  get('location-search-section').hidden = mode !== 'search';
  get('location-map-help').hidden = mode !== 'map';
  // Mode changes only replace the overlays; keep the current map instance and view.
  if (mode === 'map' && runtime) centerChanged(center);
  drawChoices(); selectedChanged(); drawMap();
}
export async function openCorrection(id) {
  if (dialog.open || document.querySelector('#member-dialog[open], #family-name-dialog[open], #import-dialog[open], .family-management-dialog[open]')) return;
  const record = FamilyApp.snapshot()?.data.people.find(p => p.id === id);
  if (!record || !Location.eligible(record)) return;
  person = structuredClone(record); opener = document.activeElement;
  const ticket = ++session;
  const position = Location.effective(person);
  center = position ? [position.lat, position.lon] : [23.7, 121];
  choices = []; saving = false; input.value = person.locationOverride?.query || person.location;
  focusKey = 'current';
  relatedMembers = FamilyApp.snapshot().data.people.filter(p => p.id !== person.id && Location.eligible(p)
    && Location.normalize(p.location) === Location.normalize(person.location)).map(p => ({
      id:p.id, expectedLocation:p.location, expectedOverride:structuredClone(p.locationOverride || null)
    }));
  get('location-apply-group').hidden = get('location-apply-note').hidden = !relatedMembers.length;
  get('location-apply-related').checked = Boolean(relatedMembers.length);
  get('location-apply-label').textContent = `一併套用至相同所在地的其他 ${relatedMembers.length} 位成員`;
  const correctedCount = relatedMembers.filter(p => p.expectedOverride).length;
  get('location-apply-note').textContent = (correctedCount ? `其中 ${correctedCount} 位已有手動位置，勾選後將一併覆蓋。` : '')
    + '取消勾選只修正目前成員；每位成員之後仍可個別修正。恢復自動定位只影響目前成員。';
  get('location-correction-person').textContent = `${person.name} · 所在地：${person.location}`;
  get('location-correction-current').textContent = position ? (Location.overrideCurrent(person) ? '已手動修正：' : '目前自動定位：') + position.displayName : '目前尚無可顯示的位置。';
  get('location-restore-auto').hidden = !Location.overrideCurrent(person);
  setMode('search'); dialog.showModal(); input.focus(); canvas.textContent = '載入地圖中…';
  try {
    const module = await import('./vendor/pigeon-map.js');
    if (!dialog.open || ticket !== session) return;
    canvas.replaceChildren(); runtime = module.mount(canvas); drawMap();
  } catch {
    if (ticket !== session) return;
    canvas.textContent = '地圖載入失敗，請關閉後重試。';
    error.textContent = '仍可搜尋並選擇候選地點。';
  }
}
get('location-mode-search').addEventListener('click', () => setMode('search'));
get('location-mode-map').addEventListener('click', () => setMode('map'));
input.addEventListener('input', () => { cancelSearch(); choices = []; selected = null; searchStatus.textContent = ''; drawChoices(); selectedChanged(); drawMap(); });
get('location-search-form').addEventListener('submit', async event => {
  event.preventDefault(); if (saving || controller || !event.target.reportValidity()) return;
  const ticket = session, query = input.value.trim();
  controller = new AbortController(); const signal = controller.signal;
  get('location-search-submit').disabled = true; error.textContent = ''; selected = null; choices = []; drawChoices(); selectedChanged();
  try {
    const items = await FamilyMemberLocations.search(query, { signal, status: message => { if (!signal.aborted) searchStatus.textContent = message; } });
    if (signal.aborted || ticket !== session) return;
    choices = items; focusKey = 'candidates-' + query;
    searchStatus.textContent = items.length ? `${items.length} 個候選地點，請選擇正確位置。` : '查無地點，請補充地名或在地圖上指定。';
    drawChoices(); drawMap();
  } catch (e) { if (!signal.aborted && ticket === session) error.textContent = e.message; }
  finally { if (ticket === session && controller?.signal === signal) { controller = null; get('location-search-submit').disabled = false; } }
});
async function persist(restore = false) {
  if (saving || (!restore && !selected)) return;
  saving = true; cancelSearch(); error.textContent = '';
  dialog.querySelectorAll('button, input').forEach(node => { node.disabled = true; });
  try {
    const command = { type: restore ? 'clearLocationOverride' : 'setLocationOverride', id: person.id,
      expectedLocation: person.location, expectedOverride: person.locationOverride || null, expectedVersion: FamilyApp.snapshot().version };
    if (!restore) {
      if (get('location-apply-related').checked && relatedMembers.length) {
        command.applyToSameLocation = true;
        command.expectedRelatedMembers = relatedMembers;
      }
      command.override = { location: person.location, source: mode === 'map' ? 'map' : 'nominatim',
        lat: selected.lat, lon: selected.lon, displayName: selected.displayName, updatedAt: Date.now() };
      if (mode === 'search') Object.assign(command.override, { query: selected.query, osmType: selected.osmType, osmId: selected.osmId });
    }
    await FamilyApp.correctLocation(command);
    dialog.close();
  } catch (e) { error.textContent = e.message; }
  finally { saving = false; dialog.querySelectorAll('button, input').forEach(node => { node.disabled = false; }); selectedChanged(); }
}
saveButton.addEventListener('click', () => persist());
get('location-restore-auto').addEventListener('click', () => persist(true));
get('close-location-correction').addEventListener('click', () => { if (!saving) dialog.close(); });
get('cancel-location-correction').addEventListener('click', () => { if (!saving) dialog.close(); });
dialog.addEventListener('cancel', event => { if (saving) event.preventDefault(); });
dialog.addEventListener('close', () => {
  ++session; cancelSearch(); runtime?.destroy(); runtime = null; canvas.replaceChildren();
  if (opener?.isConnected) opener.focus();
  else if (opener?.dataset.locationPerson) [...document.querySelectorAll('[data-location-person]')].find(node => node.dataset.locationPerson === person.id)?.focus();
  else document.querySelector(`[data-correct-person="${person.id}"]`)?.focus();
  window.dispatchEvent(new Event('familylocationcorrectionclose'));
});
window.FamilyLocationCorrection = { open: openCorrection };
