const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const Model = require('../src/assets/family-model.js');
const {createFamilyServer} = require('../dev/server.cjs');
const {renderFamilyTreeHtml} = require('../dev/site-source.cjs');
const person = (id,relationships=[]) => ({id,name:id,gender:'U',location:'',position:'',siblingOrder:null,relationships});
const cohorts = [['fellowDisciple','師兄弟姊妹'],['sibling','手足'],['swornSibling','契手足'],['tangCousin','堂親'],['student','師徒']];
function fixture() {
  const people = cohorts.flatMap(([type],i) => {
    const [a,b,c,d,e] = ['A','B','C','D','E'].map(id => `${i}${id}`);
    return [person(a,[{type,personId:b},{type,personId:c}]),
      person(b,type==='tangCousin' ? [{type:'sibling',personId:c}] : type==='student' ? [] : [{type,personId:c}]),person(c),
      person(d,[{type,personId:e}]),person(e)];
  });
  const rankGroups = cohorts.slice(0,3).map(([type],i) => ({id:'cohort'+i,name:type,type,members:['A','B','C'].map((id,j) => ({personId:`${i}${id}`,order:j+1}))}));
  const data = {schemaVersion:3,people,rankGroups};
  return {...data,ignoredIntermediatePlans:Model.intermediatePlans(data).map(p => p.id)};
}
(async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(),'family-shared-markers-'));
  const dataFile = path.join(temp,'family.json'), data = fixture();
  await fs.writeFile(dataFile,JSON.stringify(data));
  const out = path.resolve(process.env.SHARED_MARKERS_OUTPUT || '.codebase-memory/phase5-results/shared-markers');
  await fs.mkdir(out,{recursive:true});
  const server = createFamilyServer({dataFile});await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const base = `http://127.0.0.1:${server.address().port}/`, html = await renderFamilyTreeHtml({browserStorage:true});
  const results = [];let browser;
  try {
    browser = await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL || 'msedge'});
    for (const mode of ['api','static']) for (const width of [1440,390]) {
      const context = await browser.newContext({viewport:{width,height:900},hasTouch:width<700,reducedMotion:'reduce'}),page = await context.newPage(),errors = [];
      page.on('pageerror',e => errors.push(e.message));
      await context.route(/https:\/\/(.*\.google\.com|tile\.openstreetmap\.org|nominatim\.openstreetmap\.org)\//,route => route.abort());
      if (mode==='static') {
        await context.route(base,route => route.fulfill({contentType:'text/html',body:html}));
        await context.addInitScript(data => localStorage.setItem('family-static-v1:/',JSON.stringify({data,version:'shared-marker-test'})),data);
      }
      await page.goto(base);await page.waitForFunction(() => FamilyApp?.snapshot?.() && document.querySelector('#tree-connectors path[marker-end]:not([data-points])'));
      const original = await page.evaluate(() => JSON.stringify(FamilyApp.snapshot().data));
      const checks = await page.evaluate(async () => {
        const {STYLES} = await import('/assets/family-tree-renderer.mjs');
        const {captureScene} = await import('/assets/family-tree-scene.mjs');
        const {serializeSVG} = await import('/assets/family-tree-output.mjs');
        const svg = document.getElementById('tree-connectors'),defs = svg.querySelector('defs').outerHTML;
        const carriers = [...svg.querySelectorAll('path[marker-end]:not([data-points])')];
        async function paintedBounds(node,scale) {
          const clone = node.cloneNode();clone.setAttribute('d','M 100 50.1 L 100 50');clone.setAttribute('fill','none');
          // Measure only the symbol; ordinary connectors also have round caps
          // and dash patterns, which would add pixels from the tiny carrier.
          clone.setAttribute('stroke','none');
          clone.removeAttribute('marker-start');clone.removeAttribute('style');
          const xml = `<svg xmlns="http://www.w3.org/2000/svg" width="${200*scale}" height="${100*scale}" viewBox="0 0 200 100">${defs}${clone.outerHTML}</svg>`;
          const url = URL.createObjectURL(new Blob([xml],{type:'image/svg+xml'}));
          try {
            const img = new Image();img.src = url;await img.decode();
            const canvas = document.createElement('canvas');canvas.width = img.width;canvas.height = img.height;
            const ctx = canvas.getContext('2d');ctx.drawImage(img,0,0);const pixels = ctx.getImageData(0,0,img.width,img.height).data;
            let left=img.width,top=img.height,right=-1,bottom=-1;
            for(let y=0;y<img.height;y++)for(let x=0;x<img.width;x++)if(pixels[(y*img.width+x)*4+3]>32){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
            return {width:right-left+1,height:bottom-top+1};
          } finally {URL.revokeObjectURL(url);}
        }
        const checks = [];
        for(const carrier of carriers) {
          const marker = carrier.getAttribute('marker-end'),kind = marker.match(/#edge-([^)]*)/)[1];
          const normal = [...svg.querySelectorAll('path[data-points][marker-end]')].find(n => n.dataset.kind===kind);
          if(!normal)throw new Error('Missing ordinary connector reference for '+kind);
          const raster = [];
          for(const scale of [.5,1,2])raster.push({scale,actual:await paintedBounds(carrier,scale),ordinary:await paintedBounds(normal,scale)});
          checks.push({kind,expected:STYLES[kind].width,actual:parseFloat(getComputedStyle(carrier).strokeWidth),raster});
        }
        const exported = new DOMParser().parseFromString(serializeSVG(captureScene(document.getElementById('tree-canvas'))),'image/svg+xml');
        const output = [...exported.querySelectorAll('path[marker-end]')].map(n => {
          const kind = n.getAttribute('marker-end').match(/#edge-([^)]*)/)?.[1];
          return {kind,actual:Number(n.getAttribute('stroke-width') || 1),expected:STYLES[kind]?.width};
        });
        return {checks,output};
      });
      await page.screenshot({path:path.join(out,`${mode}-${width}.png`)});
      await fs.writeFile(path.join(out,`${mode}-${width}.json`),JSON.stringify(checks,null,2));
      for(const [,kind] of cohorts)assert(checks.checks.some(c => c.kind===kind),'Shared marker exercised: '+kind);
      for(const check of checks.checks) {
        assert.equal(check.actual,check.expected,`${check.kind}: shared endpoint retains ordinary stroke width`);
        for(const raster of check.raster)assert.deepEqual(raster.actual,raster.ordinary,`${check.kind}: painted symbol size at ${raster.scale}×`);
      }
      for(const check of checks.output)assert.equal(check.actual,check.expected,`${check.kind}: standalone SVG retains marker sizing`);
      assert.deepEqual(errors,[]);assert.equal(await page.evaluate(() => JSON.stringify(FamilyApp.snapshot().data)),original);
      results.push({mode,width,markers:checks.checks.length,rasterComparisons:checks.checks.length*3,status:'passed'});
      console.log(`PASS shared marker sizes ${mode} ${width}: ${checks.checks.length} endpoints`);await context.close();
    }
    await fs.writeFile(path.join(out,'report.json'),JSON.stringify({results,physicalDevices:'not_run'},null,2));
  } finally {await browser?.close();await new Promise(resolve => server.close(resolve));}
})().catch(error => {console.error(error);process.exitCode=1;});
