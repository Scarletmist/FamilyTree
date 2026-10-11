/* Isolated layout review: production source stays untouched. */
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createFamilyServer } = require('../../dev/server.cjs');
const { renderFamilyTreeHtml } = require('../../dev/site-source.cjs');
(async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'family-detail-template-'));
  const dataFile = path.join(directory, 'family.json');
  const data = JSON.parse((await fs.readFile(path.join(__dirname, '../../fixtures/family.json'), 'utf8')).replace(/^\uFEFF/, ''));
  const example = data.people.find(person => person.name === '陳文彬');
  if (example) {
    example.location = '臺南市';
    example.position = '家族資料整理';
  }
  await fs.writeFile(dataFile, JSON.stringify(data));
  const server = createFamilyServer({ dataFile });
  const [runtime] = server.listeners('request');
  server.removeAllListeners('request');
  const files = new Map([['/', ['index.html', 'text/html']], ['/index.html', ['index.html', 'text/html']], ['/preview.css', ['preview.css', 'text/css']], ['/preview.js', ['preview.js', 'text/javascript']], ['/detail.css', ['detail.css', 'text/css']], ['/detail.js', ['detail.js', 'text/javascript']]]);
  server.on('request', async (request, response) => {
    const route = new URL(request.url, 'http://localhost').pathname;
    try {
      if (request.method === 'GET' && route === '/workspace.html') {
        const html = (await renderFamilyTreeHtml()).replace('</head>', '<link rel="stylesheet" href="/detail.css"></head>').replace('</body>', '<script src="/detail.js"></script></body>');
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        response.end(html);
      } else if (request.method === 'GET' && files.has(route)) {
        const [file, type] = files.get(route);
        response.writeHead(200, { 'Content-Type': type + '; charset=utf-8', 'Cache-Control': 'no-store' });
        response.end(await fs.readFile(path.join(__dirname, file)));
      } else runtime(request, response);
    } catch (error) {
      response.writeHead(500); response.end('Preview unavailable'); console.error(error.message);
    }
  });
  server.listen(Number(process.env.DETAIL_PREVIEW_PORT || 4199), '127.0.0.1', () => console.log('Member detail template: http://127.0.0.1:' + server.address().port + '/'));
})().catch(error => { console.error(error); process.exitCode = 1; });
