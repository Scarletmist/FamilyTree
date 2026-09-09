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
    async function load() {
      submit.disabled = true; retry.hidden = true; status.textContent = '正在載入稱謂設定…';
      try {
        const response = await fetch('/data/kinship-terms.json', { cache: 'no-store' });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        config = await response.json(); engine = FamilyKinship.create(config);
        status.textContent = ''; submit.disabled = !graph; onChange();
      } catch (error) {
        engine = null; active = false; status.textContent = '稱謂設定檔載入失敗，請檢查檔案後重試。'; retry.hidden = false; onChange();
      }
    }
    retry.addEventListener('click', load);
    form.addEventListener('submit', event => { event.preventDefault(); if (!engine || !a.value || !b.value) return; active = true; pathIndex = 0; onChange(); });
    [a, b].forEach(select => select.addEventListener('change', () => { active = false; pathIndex = 0; onChange(); }));
    document.getElementById('relationship-swap').addEventListener('click', () => { const first = a.value; a.value = b.value; b.value = first; pathIndex = 0; onChange(); });
    document.getElementById('relationship-reset').addEventListener('click', () => { active = false; document.getElementById('family-filter').value = ''; onChange(); });
    function update(fullGraph) {
      graph = fullGraph;
      const names = FamilyModel.memberOptionLabels(fullGraph.people);
      for (const select of [a, b]) {
        const previous = select.value;
        select.replaceChildren(el('option', '請選擇成員')); select.options[0].value = '';
        fullGraph.people.forEach(p => { const option = el('option', names.get(p.id)); option.value = p.id; select.append(option); });
        select.value = fullGraph.people.some(p => p.id === previous) ? previous : '';
      }
      submit.disabled = !engine || !fullGraph.people.length;
      if (!a.value || !b.value) active = false;
      summary.hidden = !active; summary.replaceChildren();
      document.getElementById('family-filter').disabled = active;
      if (!active) return { graph: fullGraph, active: false };
      const result = engine.query(fullGraph, a.value, b.value);
      pathIndex = Math.min(pathIndex, Math.max(0, result.paths.length - 1));
      const path = result.paths[pathIndex], byId = new Map(fullGraph.people.map(p => [p.id, p]));
      const nameA = byId.get(a.value).name, nameB = byId.get(b.value).name;
      summary.append(el('h2', path ? nameA + ' 為 ' + nameB + ' 的' + path.title : nameA + ' 與 ' + nameB + ' 尚無已記錄的連接關係'));
      summary.append(el('p', 'A：' + nameA + '　B（稱呼基準）：' + nameB));
      if (path) {
        summary.append(el('p', '關係路徑：' + path.nodes.map(id => byId.get(id).name).join(' → ')));
        path.notes.forEach(note => summary.append(el('p', note)));
      } else summary.append(el('p', '目前僅顯示這兩位成員；可編輯成員補上已知關係。'));
      if (result.paths.length > 1) {
        const label = el('label', '其他關係路徑 '), select = document.createElement('select');
        select.setAttribute('aria-label', '其他關係路徑');
        result.paths.forEach((p, i) => { const option = el('option', (i + 1) + '. ' + p.title + '：' + p.nodes.map(id => byId.get(id).name).join(' → ')); option.value = i; select.append(option); });
        select.value = pathIndex; select.addEventListener('change', () => { pathIndex = Number(select.value); onChange(); }); label.append(select); summary.append(label);
      }
      if (result.truncated) summary.append(el('p', '等長路徑較多，目前列出前 12 條。'));
      const source = config.sources?.[0];
      if (source && /^https:\/\//.test(source.url)) { const link = el('a', '稱謂依據：' + source.title); link.className = 'kinship-source'; link.href = source.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; summary.append(link); }
      return { active: true, graph: engine.project(fullGraph, path, [a.value, b.value]), scope: [a.value, b.value, pathIndex].join('|'), aId: a.value, bId: b.value };
    }
    load();
    return { update };
  } };
})();
