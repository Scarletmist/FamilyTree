const fs = require('node:fs/promises');
const path = require('node:path');
const { ROOT, SOURCE_DIR, renderFamilyTreeHtml } = require('./site-source.cjs');

async function build(output = path.join(ROOT, 'dist')) {
  const googleClientId = (process.env.GOOGLE_OAUTH_CLIENT_ID || '').trim();
  if (googleClientId && !/^[A-Za-z0-9._-]+\.apps\.googleusercontent\.com$/.test(googleClientId)) {
    throw new Error('GOOGLE_OAUTH_CLIENT_ID 格式不正確。');
  }

  const resolvedOutput = path.resolve(output);
  if (resolvedOutput === SOURCE_DIR || resolvedOutput.startsWith(SOURCE_DIR + path.sep)) {
    throw new Error('建置輸出不可位於 src/ 內。');
  }

  const page = await renderFamilyTreeHtml({ browserStorage: true, googleClientId, published: true });
  await fs.rm(resolvedOutput, { recursive: true, force: true });
  await fs.mkdir(resolvedOutput, { recursive: true });
  await fs.cp(path.join(SOURCE_DIR, 'assets'), path.join(resolvedOutput, 'assets'), { recursive: true });
  await fs.cp(path.join(SOURCE_DIR, 'data'), path.join(resolvedOutput, 'data'), { recursive: true });
  await fs.writeFile(path.join(resolvedOutput, 'index.html'), page);
  await fs.writeFile(path.join(resolvedOutput, 'family-tree.html'), page);
  await fs.writeFile(path.join(resolvedOutput, '.nojekyll'), '');

  try {
    await fs.access(path.join(resolvedOutput, 'data', 'family.json'));
    throw new Error('建置目錄不應包含 fixtures/family.json。');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return resolvedOutput;
}

if (require.main === module) {
  build().then(dir => console.log('靜態網站已建置：' + dir)).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { build };
