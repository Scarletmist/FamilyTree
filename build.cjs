const fs = require('node:fs/promises');
const path = require('node:path');
async function build(output = path.join(__dirname, 'dist')) {
  // Explicit manifest: never copy developer family data or the server into the site.
  const html = await fs.readFile(path.join(__dirname, 'family-tree.html'), 'utf8');
  const googleClientId = (process.env.GOOGLE_OAUTH_CLIENT_ID || '').trim();
  if (googleClientId && !/^[A-Za-z0-9._-]+\.apps\.googleusercontent\.com$/.test(googleClientId)) throw new Error('GOOGLE_OAUTH_CLIENT_ID 格式不正確。');
  const scripts = [...html.matchAll(/<script src="(assets\/[a-z-]+\.js)"><\/script>/g)].map(match => match[1]);
  await fs.mkdir(path.join(output, 'assets'), { recursive: true });
  await fs.mkdir(path.join(output, 'data'), { recursive: true });
  const page = html.replace('<head>', '<head>\n  <meta name="family-storage-mode" content="browser" />')
    .replace('<meta name="google-oauth-client-id" content="" />', `<meta name="google-oauth-client-id" content="${googleClientId}" />`)
    .replaceAll('陳氏家族', '我的家族')
    .replace('匯入前會自動保留上一份資料備份。', '匯入前會在此瀏覽器保留上一份資料備份。');
  await fs.writeFile(path.join(output, 'index.html'), page);
  await fs.writeFile(path.join(output, 'family-tree.html'), page);
  await fs.writeFile(path.join(output, '.nojekyll'), '');
  for (const file of [...scripts, 'data/kinship-terms.json']) await fs.copyFile(path.join(__dirname, file), path.join(output, file));
  // Refuse a contaminated output directory rather than publish unintended files.
  const allowed = new Set(['index.html', 'family-tree.html', '.nojekyll', ...scripts, 'data/kinship-terms.json']);
  async function check(dir, prefix = '') {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const relative = prefix + entry.name;
      if (entry.isDirectory()) await check(path.join(dir, entry.name), relative + '/');
      else if (!allowed.has(relative)) throw new Error('建置目錄含非發佈檔案：' + relative + '；請移走該檔後重新建置。');
    }
  }
  await check(output);
  return output;
}
if (require.main === module) build().then(dir => console.log('靜態網站已建置：' + dir)).catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { build };
