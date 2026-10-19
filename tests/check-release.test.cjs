const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {build} = require('../dev/build.cjs');
const {checkRelease} = require('../dev/check-release.cjs');
test('release package rejects development data and broken/subpath-incompatible resources', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(),'family-release-'));
  try {
    await build(dir);assert.equal((await checkRelease(dir)).storage,'browser');
    const leaked = path.join(dir,'family.json');await fs.writeFile(leaked,'{}');
    await assert.rejects(checkRelease(dir),/測試或開發資料/);await fs.unlink(leaked);
    const html = path.join(dir,'index.html'),original = await fs.readFile(html,'utf8');
    await fs.writeFile(html,original + '<script src="assets/missing.js"></script>');
    await assert.rejects(checkRelease(dir),/資源缺漏/);
    await fs.writeFile(html,original + '<script src="/assets/family-model.js"></script>');
    await assert.rejects(checkRelease(dir),/專案子路徑/);
    await fs.writeFile(html,original.replace('content="browser"','content="api"'));
    await assert.rejects(checkRelease(dir),/瀏覽器儲存/);
  } finally {
    if (path.dirname(dir) !== path.resolve(os.tmpdir())) throw new Error('Unexpected test directory');
    await fs.rm(dir,{recursive:true,force:true});
  }
});
