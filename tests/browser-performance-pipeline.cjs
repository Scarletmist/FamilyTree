// Lab storage/derivation timings; deliberately excludes DOM rendering and field INP.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const {launchBrowser} = require('./helpers/browser-runtime.cjs');
const {performanceFixture} = require('./helpers/performance-fixture.cjs');
const {resolvePublicFile,mimeTypeFor} = require('../dev/site-source.cjs');
const scripts=['family-location','family-inference','family-schema','relationship-evidence','family-diff','family-lifecycle','family-model','family-display-projection','family-commands','family-repository','family-app'];
const sizes=(process.env.FAMILY_PERF_SIZES||'100,500,1000').split(',').map(Number);
const repeats=Number(process.env.FAMILY_PERF_REPEATS||3);
assert(sizes.length && sizes.every(n=>Number.isInteger(n)&&n>=4&&n<=1000));
assert(Number.isInteger(repeats)&&repeats>=1&&repeats<=10);
const median=values=>values.toSorted((a,b)=>a-b)[Math.floor(values.length/2)];
(async()=>{
  const html='<html><head><meta charset="utf-8"><meta name="family-storage-mode" content="browser"></head><body>'+scripts.map(name=>`<script src="assets/${name}.js"></script>`).join('')+'</body></html>';
  const report={schema_version:1,kind:'lab-command-pipeline-not-field-INP',node:process.version,platform:process.platform,engine:process.env.PLAYWRIGHT_ENGINE||'chromium',sourceHashes:{},cases:[],checks_run:0,checks_failed:0,metrics:{}};
  for(const file of ['family-model.js','family-commands.js','family-repository.js','family-app.js','member-form.js'])report.sourceHashes[file]=crypto.createHash('sha256').update(await fs.readFile(path.join(__dirname,'../src/assets',file))).digest('hex');
  const server=http.createServer(async(req,res)=>{
    try {
      const url=new URL(req.url,'http://localhost');
      if(url.pathname==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);return;}
      const file=resolvePublicFile(url.pathname);if(!file)throw Error('Not public');
      let body=await fs.readFile(file);
      if(path.basename(file)==='family-model.js') {
        const text=body.toString('utf8'),marker='function build(data) {';
        assert.equal(text.split(marker).length,2,'Instrument the one real build entry, including internal calls');
        body=Buffer.from(text.replace(marker,marker+' globalThis.__familyBuildCount = (globalThis.__familyBuildCount || 0) + 1;'));
      }
      res.setHeader('Content-Type',mimeTypeFor(file));res.end(body);
    }catch(error){res.statusCode=500;res.end(error.message);}
  });
  let browser;
  try {
    await new Promise(r=>server.listen(0,'127.0.0.1',r));browser=await launchBrowser();report.browserVersion=browser.version();
    const base=`http://127.0.0.1:${server.address().port}`;
    async function trial(data) {
      const context=await browser.newContext();
      try {
        await context.addInitScript(data=>localStorage.setItem('family-static-v1:/',JSON.stringify({data,version:'profile-source'})),data);
        const page=await context.newPage();page.setDefaultTimeout(120000);
        await page.goto(base);await page.waitForFunction(()=>globalThis.FamilyApp);
        return await page.evaluate(async expectedSize=>{
          const check=(condition,message)=>{if(!condition)throw Error(message);};
          const initial=await FamilyApp.load(),original=JSON.stringify(initial.data),count=initial.data.people.length;
          check(count===expectedSize,'The intended fixture must load: expected '+expectedSize+', got '+count);
          const member={name:'Added synthetic member',gender:'U',location:'',position:'',siblingOrder:null,relationships:[]},requestId=crypto.randomUUID();
          globalThis.__familyBuildCount=0;const start=performance.now();
          const saved=await FamilyApp.addMember({member,requestId,version:initial.version});
          const durationMs=performance.now()-start,builds=globalThis.__familyBuildCount;
          check(saved.data.people.length===count+1,'Add must commit exactly one member');
          check(JSON.stringify(initial.data)===original,'Add must not mutate the previous snapshot');
          const retry=await FamilyApp.addMember({member,requestId,version:initial.version});
          check(retry.version===saved.version&&retry.data.people.length===count+1,'Retry must be idempotent');
          let stale=false;try{await FamilyApp.updateFamilyName({familyName:'Stale write',version:initial.version});}catch(error){stale=error.status===409;}
          check(stale,'Stale writes must still be rejected');
          let invalid=false;try{await FamilyApp.addMember({member:{...member,relationships:[{type:'parent',personId:'missing',kind:'親生'}]},requestId:crypto.randomUUID(),version:saved.version});}catch(error){invalid=true;}
          check(invalid,'Invalid references must not commit');
          const persisted=await FamilyRepository.load();
          check(persisted.version===saved.version&&persisted.data.people.length===count+1,'Failed writes must leave the stored version unchanged');
          const restored=await FamilyApp.undo(saved.version);
          check(JSON.stringify(restored.data)===original,'Undo must restore the complete original data');
          check((await FamilyRepository.getSyncState()).dirty,'Writes and undo must keep the sync dirty flag');
          return {durationMs,builds,loadedMembers:count};
        },data.people.length);
      }finally{await context.close();}
    }
    for(const size of sizes)for(const shape of ['households','cohorts']) {
      try {
        const data=performanceFixture(size,shape);await trial(data); // Discard warmup.
        const samples=[];for(let i=0;i<repeats;i++)samples.push(await trial(data));
        const row={size,shape,samples,medianMs:median(samples.map(s=>s.durationMs)),maxBuilds:Math.max(...samples.map(s=>s.builds))};
        report.cases.push(row);console.log(`PASS pipeline ${size} ${shape}: ${row.maxBuilds} builds, ${row.medianMs.toFixed(1)} ms median`);
      }catch(error){report.checks_failed++;console.error(`FAIL pipeline ${size} ${shape}: ${error.stack}`);}
      report.checks_run++;
    }
    report.metrics.add_member_builds_max=Math.max(...report.cases.map(c=>c.maxBuilds));
    if(!Number.isFinite(report.metrics.add_member_builds_max))throw Error('No successful measurements');
  }finally{
    await browser?.close();await new Promise(r=>server.close(r));
    if(process.env.FAMILY_PERF_OUTPUT)await fs.writeFile(process.env.FAMILY_PERF_OUTPUT,JSON.stringify(report,null,2));
  }
  console.log('PIPELINE_RESULT '+JSON.stringify(report));if(report.checks_failed)process.exitCode=1;
})().catch(error=>{console.error(error);process.exitCode=1;});
