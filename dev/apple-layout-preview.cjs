/* Review the actual runtime against an isolated copy of the example data. */
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { createFamilyServer } = require('./server.cjs');
const { renderFamilyTreeHtml, resolvePublicFile, mimeTypeFor } = require('./site-source.cjs');
(async () => {
  if (process.argv.includes('--browser-storage')) {
    const server = http.createServer(async (request, response) => {
      try {
        const urlPath = new URL(request.url, 'http://localhost').pathname;
        const page = ['/', '/index.html', '/family-tree.html'].includes(urlPath);
        const file = page ? null : resolvePublicFile(urlPath);
        if (request.method !== 'GET' || (!page && !file)) { response.writeHead(404); response.end(); return; }
        const content = page ? await renderFamilyTreeHtml({ browserStorage:true, published:true }) : await fs.readFile(file);
        response.writeHead(200, { 'Content-Type':page ? 'text/html; charset=utf-8' : mimeTypeFor(file), 'Cache-Control':'no-store' });
        response.end(content);
      } catch (_) { response.writeHead(404); response.end(); }
    });
    server.listen(Number(process.env.PORT || 4181), '127.0.0.1', () => console.log(`瀏覽器儲存版：http://127.0.0.1:${server.address().port}/family-tree.html`));
    return;
  }
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'family-apple-layout-'));
  const dataFile = path.join(directory, 'family.json');
  await fs.copyFile(path.join(__dirname, '../fixtures/family.json'), dataFile);
  const server = createFamilyServer({ dataFile });
  server.listen(Number(process.env.PORT || 4180), '127.0.0.1', () => console.log(`正式介面（隔離示例資料）：http://127.0.0.1:${server.address().port}/family-tree.html`));
})().catch(error => { console.error(error); process.exitCode = 1; });
