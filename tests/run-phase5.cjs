/* Serial suites avoid competing local servers and keep every result inspectable. */
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const {spawn} = require('node:child_process');
const root = path.resolve(__dirname,'..');
const out = path.resolve(process.env.PHASE5_OUTPUT_DIR || path.join(root,'.codebase-memory/phase5-results'));
const filter = process.env.PHASE5_SUITE_FILTER ? new RegExp(process.env.PHASE5_SUITE_FILTER) : null;
async function run(name,command,args,env = {}) {
  const start = Date.now(),chunks = [];
  console.log('START ' + name);
  const exitCode = await new Promise(resolve => {
    const child = spawn(command,args,{cwd:root,env:{...process.env,...env,PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8'},stdio:['ignore','pipe','pipe'],windowsHide:true});
    child.stdout.on('data',data => {chunks.push(data);if (name === 'browser-phase5.cjs') process.stdout.write(data);});child.stderr.on('data',data => chunks.push(data));
    child.on('error',error => {chunks.push(Buffer.from(error.stack));resolve(-1);});child.on('close',code => resolve(code ?? -1));
  });
  const log = Buffer.concat(chunks).toString('utf8'),logFile = name.replace(/[^a-z0-9._-]/gi,'-') + '.log';
  await fs.writeFile(path.join(out,logFile),log);
  const result = {name,status:exitCode === 0 ? 'passed' : 'failed',exitCode,seconds:(Date.now() - start) / 1000,log:logFile};
  console.log(result.status.toUpperCase() + ' ' + name + ' (' + result.seconds.toFixed(1) + 's)');
  if (exitCode !== 0) console.log(log.slice(-2200));
  return result;
}
async function retrySnapshot(failed = [],runtimeOnly = false) {
  const files = [],skip = new Set(failed),unitFailed = skip.has('unit');
  async function walk(dir) {
    for (const item of await fs.readdir(dir,{withFileTypes:true})) {
      const file = path.join(dir,item.name);
      if (item.isDirectory()) {if (item.name !== '__pycache__') await walk(file);}
      else if (/\.(cjs|mjs|js|css|html|json|py)$/.test(item.name)) {
        const relative = path.relative(root,file).replaceAll(path.sep,'/');
        if (relative === 'tests/run-phase5.cjs' || (relative.startsWith('tests/') && (skip.has(item.name) || unitFailed && item.name.endsWith('.test.cjs')))) continue;
        files.push(file);
      }
    }
  }
  for (const directory of runtimeOnly ? ['src','dev'] : ['src','dev','tests']) await walk(path.join(root,directory));
  files.push(path.join(root,'package.json'),path.join(root,'.github/workflows/pages.yml'),path.join(root,'fixtures/family.json'));
  const digest = crypto.createHash('sha256');let latestModifiedMs = 0;
  for (const file of files.sort()) {digest.update(path.relative(root,file));digest.update(await fs.readFile(file));latestModifiedMs = Math.max(latestModifiedMs,(await fs.stat(file)).mtimeMs);}
  return {fingerprint:digest.digest('hex'),latestModifiedMs,files:files.length};
}
(async () => {
  await fs.mkdir(out,{recursive:true});
  const fixtureFile = path.join(root,'fixtures/family.json'),hash = data => crypto.createHash('sha256').update(data).digest('hex'),before = hash(await fs.readFile(fixtureFile));
  const files = await fs.readdir(__dirname),suites = [
    {name:'unit',args:['--test','--test-concurrency=1',...files.filter(file => file.endsWith('.test.cjs')).map(file => 'tests/' + file)]},
    ...files.filter(file => /^browser-.*\.cjs$/.test(file) && file !== 'browser-runtime.cjs').sort().map(file => ({name:file,args:['tests/' + file]})),
    ...files.filter(file => file === 'family-ui.py' || /^ux-.*\.py$/.test(file)).sort().map(file => ({name:file,args:['tests/' + file],python:true})),
    {name:'build',args:['dev/build.cjs']},{name:'release-package',args:['dev/check-release.cjs']}
  ];
  let report = {fullRegression:!filter,suiteFilter:filter?.source || null,availableSuites:suites.length,startedAt:new Date().toISOString(),node:process.version,platform:process.platform,channel:process.env.PLAYWRIGHT_CHANNEL || 'msedge',results:[],physicalDevices:{iOS:'not_run',Android:'not_run'},actualOAuth:'not_run',published:false};
  const retry = process.env.PHASE5_RETRY_FAILED === '1';let retryNames;
  if (retry) {
    if (filter) throw new Error('Retry mode cannot be combined with a suite filter');
    report = JSON.parse(await fs.readFile(path.join(out,'report.json'),'utf8'));
    const names = report.results.map(result => result.name);
    if (!report.completedAt || !report.fullRegression || names.length !== suites.length || new Set(names).size !== names.length || names.some(name => !suites.some(suite => suite.name === name))) throw new Error('A completed full regression report is required');
    retryNames = report.results.filter(result => result.status !== 'passed').map(result => result.name);
    const current = await retrySnapshot(retryNames);
    if (report.retryGuard ? current.fingerprint !== report.retryGuard.fingerprint : current.latestModifiedMs > Date.parse(report.startedAt)) throw new Error('Runtime or previously passed tests changed; run the full regression again');
    if (report.node !== process.version || report.channel !== (process.env.PLAYWRIGHT_CHANNEL || 'msedge')) throw new Error('Test runtime changed; run the full regression again');
    const archive = 'attempt-' + new Date().toISOString().replace(/[:.]/g,'-');
    await fs.mkdir(path.join(out,archive),{recursive:true});await fs.copyFile(path.join(out,'report.json'),path.join(out,archive,'report.json'));
    for (const result of report.results.filter(result => retryNames.includes(result.name))) {
      if (!/^[a-z0-9._-]+\.log$/i.test(result.log)) throw new Error('Unexpected log path');
      await fs.copyFile(path.join(out,result.log),path.join(out,archive,result.log));
    }
    report.attempts ||= [];report.attempts.push({startedAt:new Date().toISOString(),rerun:retryNames,previousReport:archive+'/report.json'});
    report.reusedPassedResults = true;report.automatedPassed = false;report.releaseReady = false;
    delete report.completedAt;
  }
  const runtimeBefore = retry ? null : await retrySnapshot([],true);
  for (const suite of suites) {
    if (filter && !filter.test(suite.name) || retry && !retryNames.includes(suite.name)) continue;
    const result = await run(suite.name,suite.python ? process.env.PYTHON_EXECUTABLE || 'python' : process.execPath,suite.args,
      {PHASE4_QUICK:'',PHASE4_PDF:'',PHASE4_OUTPUT_DIR:path.join(out,'phase4'),PHASE5_OUTPUT_DIR:out});
    if (retry) report.results[report.results.findIndex(previous => previous.name === result.name)] = result;else report.results.push(result);await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));
  }
  report.fixtureUnchanged = (!retry || report.fixtureUnchanged) && before === hash(await fs.readFile(fixtureFile));
  report.runtimeUnchanged = retry ? report.runtimeUnchanged !== false : runtimeBefore.fingerprint === (await retrySnapshot([],true)).fingerprint;
  report.completedAt = new Date().toISOString();report.automatedPassed = report.runtimeUnchanged && report.fixtureUnchanged && report.results.every(r => r.status === 'passed');
  report.retryGuard = await retrySnapshot(report.results.filter(result => result.status !== 'passed').map(result => result.name));
  report.releaseReady = report.automatedPassed && report.fullRegression && Object.values(report.physicalDevices).every(status => status === 'passed') && report.actualOAuth === 'passed';
  await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({passed:report.results.filter(r => r.status === 'passed').length,failed:report.results.filter(r => r.status !== 'passed').length,fixtureUnchanged:report.fixtureUnchanged,report:path.join(out,'report.json')},null,2));
  if (!report.automatedPassed) process.exitCode = 1;
})().catch(error => {console.error(error);process.exitCode = 1;});
