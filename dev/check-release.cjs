const fs = require('node:fs/promises');
const path = require('node:path');
async function checkRelease(directory = path.join(__dirname,'../dist')) {
  const root = path.resolve(directory),files = [];
  async function walk(dir) {
    for (const entry of await fs.readdir(dir,{withFileTypes:true})) {
      const file = path.join(dir,entry.name);
      if (entry.isSymbolicLink()) throw new Error('發布目錄不可含符號連結：' + entry.name);
      if (entry.isDirectory()) await walk(file);else files.push(file);
    }
  }
  await walk(root);
  const relative = file => path.relative(root,file).replaceAll(path.sep,'/');
  const forbidden = files.map(relative).filter(file => /(^|\/)(fixtures|tests|dev|\.codebase-memory)(\/|$)|schema-v2\.backup|(^|\/)family\.json$|\.(cjs|py|zst)$/i.test(file));
  if (forbidden.length) throw new Error('發布目錄含測試或開發資料：' + forbidden.join(', '));
  const html = await fs.readFile(path.join(root,'index.html'),'utf8');
  if (!html.includes('name="family-storage-mode" content="browser"')) throw new Error('正式頁面必須使用瀏覽器儲存模式。');
  if (html.includes('<!-- @include')) throw new Error('發布頁面仍有未展開模板。');
  const missing = [];
  for (const file of files.filter(file => /\.(html|css|m?js)$/.test(file))) {
    const source = await fs.readFile(file,'utf8'),references = [];
    if (file.endsWith('.html')) for (const match of source.matchAll(/(?:src|href)="([^"\n]+)"/g)) references.push(match[1]);
    if (/\.m?js$/.test(file)) for (const match of source.matchAll(/(?:from\s*|import\s*\()(['"])(\.\.?\/[^'"\n]+)\1/g)) references.push(match[2]);
    if (file.endsWith('.css')) for (const match of source.matchAll(/url\(\s*['"]?([^)'"\s]+)['"]?\s*\)/g)) references.push(match[1]);
    for (const reference of references) {
      if (/^(#|https?:|data:|mailto:)/.test(reference)) continue;
      if (reference.startsWith('/')) throw new Error('正式資源需支援專案子路徑：' + reference);
      const target = path.resolve(path.dirname(file),reference.split(/[?#]/)[0]);
      if (!target.startsWith(root + path.sep)) throw new Error('資源引用超出發布目錄：' + reference);
      try {await fs.access(target);} catch {missing.push(relative(file) + ' → ' + reference);}
    }
  }
  if (missing.length) throw new Error('發布資源缺漏：' + missing.join(', '));
  const bytes = (await Promise.all(files.map(file => fs.stat(file)))).reduce((total,s) => total + s.size,0);
  return {files:files.length,bytes,storage:'browser',fixturesIncluded:false,relativeResources:true};
}
if (require.main === module) checkRelease(process.argv[2]).then(result => console.log(JSON.stringify(result,null,2))).catch(error => {console.error(error.message);process.exitCode = 1;});
module.exports = {checkRelease};
