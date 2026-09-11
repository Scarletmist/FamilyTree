const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const Model = require('./assets/family-model.js');

function createFamilyServer({ dataFile = path.join(__dirname, 'data/family.json') } = {}) {
  let writes = Promise.resolve();
  const HISTORY_LIMIT = 10;
  let history = [];
  const hash = text => crypto.createHash('sha256').update(text).digest('hex');
  async function read() {
    const text = await fs.readFile(dataFile, 'utf8');
    const data = JSON.parse(text.replace(/^\uFEFF/, ''));
    Model.build(data);
    return { data, version: hash(text) };
  }
  function reply(res, status, payload) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(payload));
  }
  async function atomicWrite(file, text) {
    const temporary = file + '.' + crypto.randomUUID() + '.tmp';
    try {
      await fs.writeFile(temporary, text, { flag: 'wx' });
      await fs.rename(temporary, file);
    } finally { await fs.rm(temporary, { force: true }); }
  }
  async function persist(data) {
    const text = JSON.stringify(data, null, 2) + '\n';
    await atomicWrite(dataFile, text);
    return { data, version: hash(text) };
  }
  async function persistChange(current, data, label = '修改族譜') {
    const saved = await persist(data);
    history.unshift({ data: current.data, version: current.version, savedAt: Date.now(), label });
    history = history.slice(0, HISTORY_LIMIT);
    return saved;
  }
  function memberInput(input, id) {
    const p = { id, name: input?.name, location: input?.location, position: input?.position,
      gender: input?.gender, siblingOrder: input?.siblingOrder, relationships: input?.relationships };
    if (input?.discipleOrder !== undefined) p.discipleOrder = input.discipleOrder;
    if (input?.notes !== undefined) p.notes = input.notes;
    Model.validateMember(p);
    p.name = p.name.trim(); p.location = p.location.trim(); p.position = p.position.trim();
    return p;
  }
  async function add(body) {
    const current = await read();
    if (!body || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.requestId || '') || !body.member) return [400, { error: '新增資料格式不正確。' }];
    let p;
    try { p = memberInput(body.member, `p-${body.requestId}`); } catch (error) { return [400, { error: error.message }]; }
    // A retry after a lost response returns the original save instead of adding a duplicate.
    const existing = current.data.people.find(person => person.id === p.id);
    if (existing) return JSON.stringify(existing) === JSON.stringify(p) ? [200, { ...current, memberId: p.id }] : [409, { error: '此筆新增已儲存，請重新開啟新增表單。' }];
    if (body.version !== current.version) return [409, { error: '資料已被其他操作更新，請按「更新資料」後檢查表單再儲存。' }];
    const data = { ...current.data, people: current.data.people.concat(p) };
    try { Model.build(data); } catch (error) { return [400, { error: error.message }]; }
    return [201, { ...await persistChange(current, data, `新增成員「${p.name}」`), memberId: p.id }];
  }
  async function edit(id, body) {
    const current = await read();
    if (!current.data.people.some(p => p.id === id)) return [404, { error: '找不到要修改的成員，請更新資料。' }];
    if (body?.version !== current.version) return [409, { error: '資料已被其他操作更新，請重新載入成員資料後再修改。' }];
    let data;
    try { data = Model.replaceMember(current.data, memberInput(body.member, id)); }
    catch (error) { return [400, { error: error.message }]; }
    return [200, { ...await persistChange(current, data, `更新成員「${data.people.find(person => person.id === id)?.name || id}」`), memberId: id }];
  }
  async function updateFamilyName(body) {
    const current = await read();
    if (body?.version !== current.version) return [409, { error: '資料已被其他操作更新，請更新目前資料後確認名稱再儲存。' }];
    let familyName;
    try {
      if (!body || !Object.hasOwn(body, 'familyName')) throw new Error('請填寫家族名稱。');
      familyName = Model.normalizeFamilyName(body.familyName);
    } catch (error) { return [400, { error: error.message }]; }
    if (current.data.familyName === familyName) return [200, current];
    // Preserve all members, relationships and unknown top-level metadata.
    return [200, await persistChange(current, { ...current.data, familyName }, '修改家族名稱')];
  }
  async function updateIntermediateIgnore(body) {
    const current = await read();
    if (body?.version !== current.version) return [409, { error: '資料已被其他操作更新，請更新目前資料後再操作。' }];
    if (typeof body?.planId !== 'string' || !body.planId || body.planId.length > 500 || typeof body?.ignored !== 'boolean') return [400, { error: '待補項目設定格式不正確。' }];
    const allPlans = Model.intermediatePlans(current.data, { includeIgnored: true });
    const ignored = new Set(Model.ignoredIntermediatePlanIds(current.data));
    const target = allPlans.find(plan => plan.id === body.planId);
    if (body.ignored && !target) return [409, { error: '此待補項目已不存在，請更新資料後再試。' }];
    const slotIds = target ? allPlans.filter(plan => plan.slotId === target.slotId).map(plan => plan.id) : [body.planId];
    slotIds.forEach(id => body.ignored ? ignored.add(id) : ignored.delete(id));
    return [200, await persistChange(current, { ...current.data, ignoredIntermediatePlans: [...ignored].sort() }, body.ignored ? '忽略待補親屬' : '恢復待補親屬')];
  }
  async function importFamily(body) {
    const current = await read();
    if (body?.version !== current.version) return [409, { error: '目前資料已更新，請按「更新目前資料」確認後再匯入。' }];
    try { Model.build(body.data); } catch (error) { return [400, { error: error.message }]; }
    // Keep the previous dataset recoverable before replacing the whole family.
    await atomicWrite(dataFile + '.backup.json', JSON.stringify(current.data, null, 2) + '\n');
    return [200, { ...await persistChange(current, body.data, '匯入族譜'), backupCreated: true }];
  }
  async function undoFamily(body) {
    const current = await read();
    if (body?.version !== current.version) return [409, { error: '資料已被其他操作更新，無法復原舊版本。請先更新資料。' }];
    if (!history.length) return [409, { error: '目前沒有可復原的修改。' }];
    const target = history.shift();
    try { Model.build(target.data); } catch (error) { return [400, { error: error.message }]; }
    const saved = await persist(target.data);
    return [200, { ...saved, undoneLabel: target.label || '上一項修改' }];
  }
  const assets = new Map([
    ['/', ['family-tree.html', 'text/html']],
    ['/data/kinship-terms.json', ['data/kinship-terms.json', 'application/json']],
    ['/family-tree.html', ['family-tree.html', 'text/html']],
    ...['label-layout.js', 'connector-routing.js', 'family-repository.js', 'member-tools.js', 'kinship.js', 'relationship-search.js', 'family-model.js', 'relationship-details.js', 'generation-bands.js', 'family-tree.js', 'family-storage.js', 'member-form.js', 'google-drive-sync.js', 'mobile-gesture-policy.js', 'mobile-landscape-toolbar.js'].map(name => ['/assets/' + name, ['assets/' + name, 'text/javascript']])
  ]);
  const server = http.createServer(async (req, res) => {
    try {
      const expected = new Set([`127.0.0.1:${server.address().port}`, `localhost:${server.address().port}`]);
      if (!expected.has(req.headers.host)) return reply(res, 403, { error: '不允許此主機來源。' });
      const url = new URL(req.url, `http://${req.headers.host}`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Referrer-Policy', 'same-origin');
      if (req.method === 'GET' && url.pathname === '/api/family') return reply(res, 200, await read());
      if (req.method === 'GET' && url.pathname === '/index.html') {
        res.writeHead(301, { Location: '/' }); return res.end();
      }
      if (req.method === 'GET' && url.pathname === '/api/family/export') {
        const { data } = await read();
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': 'attachment; filename="family.json"', 'Cache-Control': 'no-store' });
        return res.end(JSON.stringify(data, null, 2) + '\n');
      }
      const editMatch = /^\/api\/members\/([a-zA-Z0-9_-]{1,80})$/.exec(url.pathname);
      const isImport = req.method === 'POST' && url.pathname === '/api/family/import';
      const isNameUpdate = req.method === 'PUT' && url.pathname === '/api/family/name';
      const isIntermediateIgnore = req.method === 'PUT' && url.pathname === '/api/family/intermediate-ignore';
      const isUndo = req.method === 'POST' && url.pathname === '/api/family/undo';
      if ((req.method === 'POST' && url.pathname === '/api/members') || (req.method === 'PUT' && editMatch) || isImport || isNameUpdate || isIntermediateIgnore || isUndo) {
        if (req.headers.origin !== `http://${req.headers.host}` || req.headers['content-type']?.split(';')[0] !== 'application/json') return reply(res, 403, { error: '只允許從本網站提交表單。' });
        const chunks = []; let bytes = 0;
        for await (const chunk of req) {
          bytes += chunk.length;
          if (bytes > (isImport ? 6 * 1024 * 1024 : 65536)) { reply(res, 413, { error: '提交內容過大。' }); return; }
          chunks.push(chunk);
        }
        let body;
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return reply(res, 400, { error: 'JSON 格式不正確。' }); }
        const operation = writes.then(() => isUndo ? undoFamily(body) : isImport ? importFamily(body) : isNameUpdate ? updateFamilyName(body) : isIntermediateIgnore ? updateIntermediateIgnore(body) : editMatch ? edit(editMatch[1], body) : add(body));
        writes = operation.catch(() => {});
        const [status, payload] = await operation;
        return reply(res, status, payload);
      }
      const asset = assets.get(url.pathname);
      if (req.method === 'GET' && asset) {
        const content = await fs.readFile(path.join(__dirname, asset[0]));
        res.writeHead(200, { 'Content-Type': asset[1] + '; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end(content);
      }
      return reply(res, 404, { error: '找不到此頁面。' });
    } catch (error) {
      console.error('族譜伺服器：', error.message);
      if (!res.headersSent) reply(res, 500, { error: '無法讀取或寫入族譜檔案，資料尚未儲存。請檢查檔案與權限後重試。' });
      else res.end();
    }
  });
  return server;
}
if (require.main === module) {
  const port = Number(process.env.PORT || 4173);
  const server = createFamilyServer();
  server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? `連接埠 ${port} 已使用，請設定 PORT 換一個連接埠。` : error.message); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => console.log(`族譜網站：http://127.0.0.1:${server.address().port}/family-tree.html`));
}
module.exports = { createFamilyServer };
