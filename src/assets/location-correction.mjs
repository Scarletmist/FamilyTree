import { setMapIcon } from './map-icons.mjs';
const Location = window.FamilyLocation;
let host, panel;
let person = null, mode = 'search', selected = null, searchSelection = null, choices = [], controller = null;
let relatedMembers = [], center = [23.7, 121], saving = false, session = 0, focusKey = '', opening = false;
const get = id => panel.querySelector('#' + id);
function text(tag, value, className = '') { const node = document.createElement(tag); node.textContent = value; node.className = className; return node; }

export function configureCorrection(workspace) {
  host = workspace; panel = host.editor;
  panel.innerHTML = `<div class="member-map-panel-heading"><h3 id="location-correction-person"></h3><p id="location-correction-place"></p></div>
    <div class="location-correction-sidebar member-map-panel-scroll">
      <div class="location-correction-modes" role="group" aria-label="修正方式"><button type="button" id="location-mode-search" class="plain-button" aria-pressed="true"></button><button type="button" id="location-mode-map" class="plain-button" aria-pressed="false"></button></div>
      <p id="location-mode-caption" class="location-mode-caption"></p>
      <div id="location-search-section"><form id="location-search-form"><label for="location-search-query">補充地名或縣市</label><div class="location-search-input"><input id="location-search-query" maxlength="120" required autocomplete="off" placeholder="輸入地名" /><button type="submit" class="plain-button" id="location-search-submit"></button></div></form><p id="location-search-status" role="status" aria-live="polite"></p><div id="location-search-results" aria-label="候選地點"></div></div>
      <p id="location-map-help" class="form-note" hidden>移動地圖，將地點對準中央準星。</p>
      <div class="location-selection-card"><small>修正位置</small><p id="location-selection-status" role="status" aria-live="polite"></p><p id="location-correction-current" class="form-note"></p></div>
      <label id="location-apply-group" class="location-apply-group" hidden><input type="checkbox" id="location-apply-related" /><span id="location-apply-label"></span></label>
      <details id="location-apply-scope" hidden><summary>查看影響成員</summary><p id="location-apply-members"></p><p id="location-apply-note" class="form-note"></p></details>
      <p id="location-correction-error" class="form-error" role="alert"></p>
    </div>
    <footer class="location-correction-actions member-map-panel-footer"><details id="location-more-actions"><summary id="location-more-button" aria-label="更多地點操作" title="更多地點操作"></summary><div class="location-more-menu"><button type="button" id="location-restore-auto" hidden>恢復此成員的自動定位</button></div></details><div class="location-save-summary"><span id="location-apply-summary"></span><small>儲存後可復原</small></div><button type="button" id="save-location-correction" class="primary-button" disabled></button></footer>`;
  for (const [id, icon, label] of [
    ['location-mode-search', 'search', '搜尋地點'], ['location-mode-map', 'pick', '在地圖上指定'],
    ['location-search-submit', 'search', '查詢'], ['location-more-button', 'more', '更多地點操作'],
    ['save-location-correction', 'save', '使用此位置']
  ]) setMapIcon(get(id), icon, label);
  get('location-mode-search').addEventListener('click', () => setMode('search'));
  get('location-mode-map').addEventListener('click', () => setMode('map'));
  get('location-search-query').addEventListener('input', () => {
    cancelSearch(); choices = []; selected = searchSelection = null; get('location-search-status').textContent = '';
    drawChoices(); selectedChanged(); drawMap();
  });
  get('location-search-form').addEventListener('submit', search);
  get('location-apply-related').addEventListener('change', updateScope);
  get('save-location-correction').addEventListener('click', () => persist());
  get('location-restore-auto').addEventListener('click', () => persist(true));
}
function cancelSearch() { controller?.abort(); controller = null; if (panel) get('location-search-submit').disabled = saving; }
function selectedChanged() {
  get('location-selection-status').textContent = selected ? (mode === 'map' ? '中央準星指定位置' : selected.displayName) : '尚未選擇位置';
  get('save-location-correction').disabled = saving || !selected;
}
function updateScope() {
  const apply = get('location-apply-related').checked;
  get('location-apply-summary').textContent = `將套用至 ${apply ? relatedMembers.length + 1 : 1} 位成員`;
  get('location-apply-members').textContent = [person.name, ...(apply ? relatedMembers.map(p => p.name) : [])].join('、');
  const corrected = apply ? relatedMembers.filter(p => p.expectedOverride).length : 0;
  get('location-apply-note').textContent = (corrected ? `其中其他 ${corrected} 位已有手動位置，套用後將更新。` : '')
    + '每位成員之後仍可個別修正。恢復自動定位只影響目前成員。';
}
function drawChoices() {
  get('location-search-results').replaceChildren();
  choices.forEach((choice, index) => {
    const button = text('button', '', 'location-candidate plain-button'); button.type = 'button';
    button.dataset.candidate = String(index); button.setAttribute('aria-pressed', String(searchSelection === choice));
    button.append(text('strong', choice.name || choice.displayName.split(',')[0]), text('span', choice.displayName));
    button.addEventListener('click', () => choose(index)); get('location-search-results').append(button);
  });
}
function choose(index) {
  if (!choices[index]) return;
  selected = searchSelection = choices[index]; focusKey = 'candidate-' + index;
  host.focusPoint([selected.lat, selected.lon]); drawChoices(); selectedChanged(); drawMap();
}
const centerChanged = next => {
  center = next;
  if (mode === 'map') { selected = { lat:next[0], lon:next[1], displayName:'地圖指定位置' }; selectedChanged(); }
};
function drawMap() {
  if (!person || !host.editing()) return;
  const initial = Location.effective(person);
  const groups = mode === 'map' ? [] : choices.length ? choices.map((choice, index) => ({ key:'candidate-' + index,
    lat:choice.lat, lon:choice.lon, label:choice.name || choice.displayName, people:[{ name:choice.displayName }] }))
    : initial ? [{ key:'edit-current', lat:initial.lat, lon:initial.lon, label:person.location, people:[{ name:person.name }] }] : [];
  host.updateMap({ groups, clustering:false, focusKey, selectedKey:mode === 'search' && searchSelection ? focusKey : '',
    initialCenter:center, initialZoom:initial ? 15 : 7, picking:mode === 'map', onCenterChange:centerChanged,
    onSelect:key => choose(Number(key.replace('candidate-', ''))) });
}
function setMode(next) {
  cancelSearch(); mode = next; selected = mode === 'search' ? searchSelection : null;
  get('location-correction-error').textContent = '';
  get('location-mode-search').setAttribute('aria-pressed', String(mode === 'search'));
  get('location-mode-map').setAttribute('aria-pressed', String(mode === 'map'));
  get('location-mode-caption').textContent = mode === 'map' ? '在地圖上指定' : '搜尋地點';
  get('location-search-section').hidden = mode !== 'search'; get('location-map-help').hidden = mode !== 'map';
  if (mode === 'map' && host.view()) centerChanged(host.view().visibleCenter);
  drawChoices(); selectedChanged(); drawMap();
}
export async function openCorrection(id) {
  if (!host || saving || opening || host.editing() || document.querySelector('#member-dialog[open], #family-name-dialog[open], #import-dialog[open], .family-management-dialog[open]')) return;
  const record = FamilyApp.snapshot()?.data.people.find(p => p.id === id);
  if (!record || !Location.eligible(record)) return;
  opening = true; const ticket = ++session;
  try {
    if (!await host.enter(record) || ticket !== session) return;
    person = structuredClone(record); choices = []; selected = searchSelection = null; saving = false;
    const position = Location.effective(person);
    center = position ? [position.lat, position.lon] : [23.7, 121]; focusKey = 'edit-current';
    get('location-search-query').value = person.locationOverride?.query || person.location;
    relatedMembers = FamilyApp.snapshot().data.people.filter(p => p.id !== person.id && Location.eligible(p)
      && Location.normalize(p.location) === Location.normalize(person.location)).map(p => ({
        id:p.id, name:p.name, expectedLocation:p.location, expectedOverride:structuredClone(p.locationOverride || null)
      }));
    get('location-apply-group').hidden = get('location-apply-scope').hidden = !relatedMembers.length;
    get('location-apply-related').checked = Boolean(relatedMembers.length); get('location-apply-scope').open = false;
    get('location-apply-label').textContent = `一併套用至相同所在地的其他 ${relatedMembers.length} 位成員`;
    updateScope(); get('location-correction-person').textContent = person.name;
    get('location-correction-place').textContent = '所在地 · ' + person.location;
    get('location-correction-current').textContent = position ? (Location.overrideCurrent(person) ? '原手動位置：' : '原自動定位：') + position.displayName : '原所在地文字會保留。';
    get('location-restore-auto').hidden = !Location.overrideCurrent(person);
    get('location-more-actions').hidden = !Location.overrideCurrent(person); get('location-more-actions').open = false;
    get('location-search-status').textContent = ''; setMode(position ? 'map' : 'search'); host.focusBack();
  } finally { if (ticket === session) opening = false; }
}
async function search(event) {
  event.preventDefault(); if (saving || controller || !event.target.reportValidity()) return;
  const ticket = session, query = get('location-search-query').value.trim();
  controller = new AbortController(); const signal = controller.signal;
  get('location-search-submit').disabled = true; get('location-correction-error').textContent = '';
  selected = searchSelection = null; choices = []; drawChoices(); selectedChanged();
  try {
    const items = await FamilyMemberLocations.search(query, { signal, status:message => { if (!signal.aborted) get('location-search-status').textContent = message; } });
    if (signal.aborted || ticket !== session) return;
    choices = items; focusKey = 'candidates-' + query; host.clearViewRequest();
    get('location-search-status').textContent = items.length ? `${items.length} 個候選地點，請選擇正確位置。` : '查無地點，請補充地名或在地圖上指定。';
    drawChoices(); drawMap();
  } catch (e) { if (!signal.aborted && ticket === session) get('location-correction-error').textContent = e.message; }
  finally { if (ticket === session && controller?.signal === signal) { controller = null; get('location-search-submit').disabled = false; } }
}
async function persist(restore = false) {
  if (saving || (!restore && !selected)) return;
  saving = true; cancelSearch(); get('location-correction-error').textContent = ''; host.busy(true);
  try {
    const command = { type:restore ? 'clearLocationOverride' : 'setLocationOverride', id:person.id,
      expectedLocation:person.location, expectedOverride:person.locationOverride || null, expectedVersion:FamilyApp.snapshot().version };
    if (!restore) {
      if (get('location-apply-related').checked && relatedMembers.length) {
        command.applyToSameLocation = true; command.expectedRelatedMembers = relatedMembers.map(({ name, ...guard }) => guard);
      }
      command.override = { location:person.location, source:mode === 'map' ? 'map' : 'nominatim',
        lat:selected.lat, lon:selected.lon, displayName:selected.displayName, updatedAt:Date.now() };
      if (mode === 'search') Object.assign(command.override, { query:selected.query, osmType:selected.osmType, osmId:selected.osmId });
    }
    const payload = await FamilyApp.correctLocation(command);
    const count = !restore && command.applyToSameLocation ? relatedMembers.length + 1 : 1;
    finish({ payload, personId:person.id, message:restore ? '已恢復此成員的自動定位' : `已更新 ${count} 位成員的位置` });
  } catch (e) { get('location-correction-error').textContent = e.message; }
  finally { saving = false; host.busy(false); selectedChanged(); }
}
function finish(result) { ++session; cancelSearch(); person = null; opening = false; host.finish(result); window.dispatchEvent(new Event('familylocationcorrectionclose')); }
export const correction = {
  back:() => { if (!saving) finish(); },
  close:() => { ++session; cancelSearch(); person = null; opening = false; window.dispatchEvent(new Event('familylocationcorrectionclose')); },
  busy:() => saving
};
window.FamilyLocationCorrection = { open:openCorrection };
