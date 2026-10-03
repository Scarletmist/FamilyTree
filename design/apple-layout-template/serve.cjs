/* Local preview for the isolated layout template. No production data or APIs. */
const http=require('node:http');
const fs=require('node:fs/promises');
const path=require('node:path');
const files=new Set(['index.html','template.css','workspace.html','workspace.css','workspace.js']);
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8'};
const server=http.createServer(async(req,res)=>{const name=new URL(req.url,'http://localhost').pathname.slice(1)||'index.html';if(!files.has(name)){res.writeHead(404);res.end('Not found');return;}try{res.writeHead(200,{'Content-Type':types[path.extname(name)],'Cache-Control':'no-store'});res.end(await fs.readFile(path.join(__dirname,name)));}catch{res.writeHead(500);res.end('Preview unavailable');}});
server.listen(Number(process.env.LAYOUT_PREVIEW_PORT||4198),'127.0.0.1',()=>process.stdout.write('Layout preview: http://127.0.0.1:'+server.address().port+'/\n'));
