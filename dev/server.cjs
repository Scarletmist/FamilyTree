/* Local development/test harness only. Production GitHub Pages persists family data in browser IndexedDB. */
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const Model = require('../src/assets/family-model.js');
const Commands = require('../src/assets/family-commands.js');
const { renderFamilyTreeHtml, resolvePublicFile, mimeTypeFor } = require('./site-source.cjs');

function createFamilyServer({ dataFile = path.join(__dirname, '../fixtures/family.json') } = {}) {
  let writes = Promise.resolve();
  const HISTORY_LIMIT = 10;
  let history = [];
  const hash = text => crypto.createHash('sha256').update(text).digest('hex');
  async function read() {
    const text = await fs.readFile(dataFile, 'utf8');
    const data = JSON.parse(text.replace(/^\uFEFF/, ''));
    Model.build(data);
    return { data, version: hash(text), undoLabel: history[0]?.label || null };
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
    return { ...saved, undoLabel: label };
  }
  function applyCommand(data, command) {
    try { return { change: Commands.apply(data, command) }; }
    catch (error) { return { error, status: error.status || 400 }; }
  }
  async function add(body) {
    const current = await read();
    if (!body || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.requestId || '') || !body.member) {
      return [400, { error: '新增資料格式不正確。' }];
    }
    let candidate;
    try { candidate = Commands.memberInput(body.member, 'p-' + body.requestId); }
    catch (error) { return [error.status || 400, { error: error.message }]; }
    // A retry after a lost response returns the original save before stale-version rejection.
    const existing = current.data.people.find(person => person.id === candidate.id);
    if (existing) return JSON.stringify(existing) === JSON.stringify(candidate)
      ? [200, { ...current, memberId: candidate.id }]
      : [409, { error: '此筆新增已儲存，請重新開啟新增表單。' }];
    if (body.version !== current.version) return [409, { error: '資料已被其他操作更新，請按「更新資料」後檢查表單再儲存。' }];
    const { change, error, status } = applyCommand(current.data, { type: 'addMember', member: body.member, requestId: body.requestId });
    if (error) return [status, { error: error.message }];
    return [201, { ...await persistChange(current, change.data, change.label), memberId: change.memberId }];
  }
  async function edit(id, body) {
    const current = await read();
    if (!current.data.people.some(person => person.id === id)) return [404, { error: '找不到要修改的成員，請更新資料。' }];
    if (body?.version !== current.version) return [409, { error: '資料已被其他操作更新，請重新載入成員資料後再修改。' }];
    const { change, error, status } = applyCommand(current.data, { type: 'updateMember', id, member: body?.member });
    if (error) return [status, { error: error.message }];
    return [200, { ...await persistChange(current, change.data, change.label), memberId: change.memberId }];
  }
  async function updateFamilyName(body) {
    const current = await read();
    if (body?.version !== current.version) return [409, { error: '資料已被其他操作更新，請更新目前資料後確認名稱再儲存。' }];
    const { change, error, status } = applyCommand(current.data, { type: 'updateFamilyName', familyName: body?.familyName });
    if (error) return [status, { error: error.message }];
    if (change.unchanged) return [200, current];
    return [200, await persistChange(current, change.data, change.label)];
  }
  async function updateIntermediateIgnore(body) {
    const current = await read();
    if (body?.version !== current.version) return [409, { error: '資料已被其他操作更新，請更新目前資料後再操作。' }];
    const { change, error, status } = applyCommand(current.data, { type: 'updateIntermediateIgnore', planId: body?.planId, ignored: body?.ignored });
    if (error) return [status, { error: error.message }];
    return [200, await persistChange(current, change.data, change.label)];
  }
  async function importFamily(body) {
    const current = await read();
    if (body?.version !== current.version) return [409, { error: '目前資料已更新，請按「更新目前資料」確認後再匯入。' }];
    const { change, error, status } = applyCommand(current.data, { type: 'importFamily', data: body?.data });
    if (error) return [status, { error: error.message }];
    await atomicWrite(dataFile + '.backup.json', JSON.stringify(current.data, null, 2) + '\n');
    return [200, { ...await persistChange(current, change.data, change.label), backupCreated: true }];
  }
  async function undoFamily(body) {
    const current = await read();
    if (body?.version !== current.version) return [409, { error: '資料已被其他操作更新，無法復原舊版本。請先更新資料。' }];
    if (!history.length) return [409, { error: '目前沒有可復原的修改。' }];
    const target = history[0];
    try { Model.build(target.data); } catch (error) { return [400, { error: error.message }]; }
    const saved = await persist(target.data);
    history.shift();
    return [200, { ...saved, undoLabel: history[0]?.label || null, undoneLabel: target.label || '上一項修改' }];
  }
  async function manageFamily(body) {
    const current = await read();
    if (body?.version !== current.version) return [409, { error: '資料已更新，請重新整理頁面後，再開啟管理視窗確認變更。' }];
    const { change, error, status } = applyCommand(current.data, { ...body, type: 'manageFamily' });
    if (error) return [status, { error: error.message }];
    return [200, await persistChange(current, change.data, change.label)];
  }
  const server = http.createServer(async (req, res) => {
    try {
      const expected = new Set([`127.0.0.1:${server.address().port}`, `localhost:${server.address().port}`]);
      if (!expected.has(req.headers.host)) return reply(res, 403, { error: '不允許此主機來源。' });
      const url = new URL(req.url, `http://${req.headers.host}`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
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
      const isManage = req.method === 'POST' && url.pathname === '/api/family/manage';
      const isLocation = req.method === 'POST' && url.pathname === '/api/family/locations';
      if ((req.method === 'POST' && url.pathname === '/api/members') || (req.method === 'PUT' && editMatch) || isImport || isNameUpdate || isIntermediateIgnore || isUndo || isManage || isLocation) {
        if (req.headers.origin !== `http://${req.headers.host}` || req.headers['content-type']?.split(';')[0] !== 'application/json') return reply(res, 403, { error: '只允許從本網站提交表單。' });
        const chunks = []; let bytes = 0;
        for await (const chunk of req) {
          bytes += chunk.length;
          if (bytes > (isImport || isManage ? 6 * 1024 * 1024 : 65536)) { reply(res, 413, { error: '提交內容過大。' }); return; }
          chunks.push(chunk);
        }
        let body;
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return reply(res, 400, { error: 'JSON 格式不正確。' }); }
        const operation = writes.then(async () => {
          if (isLocation) {
            if (!['updateLocations','claimLocationLookup','resetLocation','setLocationOverride','clearLocationOverride'].includes(body.type)) return [400, { error: '不支援的定位操作。' }];
            const current = await read();
            if (body.expectedVersion && body.expectedVersion !== current.version) return [409, { error: '資料已更新，請重新開啟地點修正。' }];
            const { change, error, status } = applyCommand(current.data, body);
            if (error) return [status, { error: error.message }];
            if (change.unchanged) return [200, current];
            const saved = change.metadataOnly ? await persist(change.data) : await persistChange(current, change.data, change.label);
            return [200, { ...saved, undoLabel: history[0]?.label || null }];
          }
          return isManage ? manageFamily(body) : isUndo ? undoFamily(body) : isImport ? importFamily(body) : isNameUpdate ? updateFamilyName(body) : isIntermediateIgnore ? updateIntermediateIgnore(body) : editMatch ? edit(editMatch[1], body) : add(body);
        });
        writes = operation.catch(() => {});
        const [status, payload] = await operation;
        return reply(res, status, payload);
      }
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/family-tree.html')) {
        const content = await renderFamilyTreeHtml();
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end(content);
      }
      if (req.method === 'GET') {
        const file = resolvePublicFile(url.pathname);
        if (file) {
          try {
            const content = await fs.readFile(file);
            res.writeHead(200, { 'Content-Type': mimeTypeFor(file) + '; charset=utf-8', 'Cache-Control': 'no-store' });
            return res.end(content);
          } catch (error) {
            if (error.code !== 'ENOENT') throw error;
          }
        }
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
