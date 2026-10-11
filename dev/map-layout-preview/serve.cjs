const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const server = http.createServer((req, res) => {
  if (!['/', '/index.html'].includes(req.url)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, {'Content-Type':'text/html; charset=utf-8', 'Cache-Control':'no-store'});
  res.end(fs.readFileSync(path.join(__dirname, 'index.html')));
});
server.listen(0, '127.0.0.1', () => console.log(`http://127.0.0.1:${server.address().port}/`));
