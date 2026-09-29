const fs = require('node:fs/promises');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SOURCE_DIR = path.join(ROOT, 'src');
const PAGE_TEMPLATE = path.join(SOURCE_DIR, 'family-tree.html');
const INCLUDE_RE = /<!--\s*@include\s+([a-zA-Z0-9_./-]+)\s*-->/g;

function inside(base, target) {
  const relative = path.relative(base, target);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative);
}

async function expandIncludes(html) {
  const matches = [...html.matchAll(INCLUDE_RE)];
  for (const match of matches) {
    const target = path.resolve(SOURCE_DIR, match[1]);
    if (!inside(SOURCE_DIR, target)) throw new Error('HTML include 超出 src：' + match[1]);
    const partial = await fs.readFile(target, 'utf8');
    html = html.replace(match[0], partial.trimEnd());
  }
  return html;
}

async function renderFamilyTreeHtml({
  browserStorage = false,
  googleClientId = '',
  published = false
} = {}) {
  let html = await expandIncludes(await fs.readFile(PAGE_TEMPLATE, 'utf8'));
  if (browserStorage) html = html.replace('<head>', '<head>\n  <meta name="family-storage-mode" content="browser" />');
  html = html.replace(
    '<meta name="google-oauth-client-id" content="" />',
    `<meta name="google-oauth-client-id" content="${googleClientId}" />`
  );
  if (published) {
    html = html
      .replaceAll('陳氏家族', '我的家族')
      .replace('匯入前會自動保留上一份資料備份。', '匯入前會在此瀏覽器保留上一份資料備份。');
  }
  return html;
}

function resolvePublicFile(urlPath) {
  const relative = path.posix.normalize('/' + String(urlPath || '')).replace(/^\/+/, '');
  if (!(relative.startsWith('assets/') || relative.startsWith('data/'))) return null;
  const target = path.resolve(SOURCE_DIR, ...relative.split('/'));
  return inside(SOURCE_DIR, target) ? target : null;
}

function mimeTypeFor(file) {
  if (/\.m?js$/i.test(file)) return 'text/javascript';
  if (/\.css$/i.test(file)) return 'text/css';
  if (/\.json$/i.test(file)) return 'application/json';
  if (/\.html?$/i.test(file)) return 'text/html';
  return 'application/octet-stream';
}

module.exports = { ROOT, SOURCE_DIR, PAGE_TEMPLATE, renderFamilyTreeHtml, resolvePublicFile, mimeTypeFor };
