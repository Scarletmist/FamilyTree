// Real project checks with an adapter for the repository's harness evidence contract.
const fs = require('node:fs/promises');
const path = require('node:path');
const {spawn} = require('node:child_process');
const root=path.resolve(__dirname,'..');
function unitResult(output) {
  const count=name=>{const matches=[...output.matchAll(new RegExp('^# '+name+' (\\d+)\\s*$','gm'))];if(matches.length!==1)throw Error('Missing or ambiguous Node summary: '+name);return Number(matches[0][1]);};
  const tests=count('tests'),skipped=count('skipped'),cancelled=count('cancelled'),failed=count('fail');
  const checks_run=tests-skipped;
  if(checks_run<=0)throw Error('No executed Node tests');
  return {checks_run,checks_failed:failed+cancelled,metrics:{}};
}
function browserResult(output,code) {
  const passed=(output.match(/^PASS\b/gm)||[]).length,failed=(output.match(/^FAIL\b/gm)||[]).length;
  if(passed+failed===0)throw Error('No executed browser scenarios');
  return {checks_run:passed+failed,checks_failed:failed+(code!==0&&failed===0?1:0),metrics:{}};
}
function pipelineResult(output) {
  const rows=output.split(/\r?\n/).filter(line=>line.startsWith('PIPELINE_RESULT '));
  if(rows.length!==1)throw Error('Missing pipeline result');
  const result=JSON.parse(rows[0].slice('PIPELINE_RESULT '.length));
  if(!Number.isInteger(result.checks_run)||result.checks_run<=0||!Number.isInteger(result.checks_failed)||result.checks_failed<0||!Number.isFinite(result.metrics?.add_member_builds_max))throw Error('Invalid pipeline result');
  if(!Array.isArray(result.cases)||result.cases.length!==result.checks_run-result.checks_failed)throw Error('Missing measured cases');
  const builds=[];
  for(const row of result.cases) {
    if(!Number.isInteger(row.size)||row.size<4||!Array.isArray(row.samples)||!row.samples.length)throw Error('Missing pipeline samples');
    for(const sample of row.samples) {
      if(sample.loadedMembers!==row.size||!Number.isFinite(sample.durationMs)||sample.durationMs<0||!Number.isInteger(sample.builds)||sample.builds<1)throw Error('Invalid fixture or measurement');
      builds.push(sample.builds);
    }
  }
  if(!builds.length||Math.max(...builds)!==result.metrics.add_member_builds_max)throw Error('Build metric does not match samples');
  return result;
}
async function run(args,env={}) {
  return await new Promise(resolve=>{
    const child=spawn(process.execPath,args,{cwd:root,env:{...process.env,...env},windowsHide:true,stdio:['ignore','pipe','pipe']});let output='',settled=false;
    child.stdout.on('data',data=>{output+=data;process.stdout.write(data);});child.stderr.on('data',data=>{output+=data;process.stderr.write(data);});
    child.on('error',error=>{if(!settled){settled=true;resolve({code:-1,output:output+'\n'+error.stack});}});
    child.on('close',code=>{if(!settled){settled=true;resolve({code:code??-1,output});}});
  });
}
async function main(suite) {
  const result={schema_version:1,checks_run:0,checks_failed:0,metrics:{}};
  let exit=0;
  try {
    let jobs;
    if(suite==='unit')jobs=[['unit',['--test','--test-concurrency=1','--test-reporter=tap',...(await fs.readdir(path.join(root,'tests'))).filter(f=>f.endsWith('.test.cjs')).sort().map(f=>'tests/'+f)]]];
    else if(suite==='browser-smoke')jobs=[['browser',['tests/browser-p1-accessibility.cjs']],['browser',['tests/browser-ui-improvements.cjs']]];
    else if(suite==='performance')jobs=[['performance',['tests/browser-performance-pipeline.cjs']]];
    else throw Error('Unknown suite: '+suite);
    for(const [type,args] of jobs) {
      const runResult=await run(args);
      const parsed=type==='unit'?unitResult(runResult.output):type==='performance'?pipelineResult(runResult.output):browserResult(runResult.output,runResult.code);
      if(type==='browser') {
        const expected=args[0].includes('browser-p1-accessibility')?15:8;
        if(parsed.checks_run!==expected)throw Error('Incomplete browser suite: '+parsed.checks_run+' of '+expected);
      }
      result.checks_run+=parsed.checks_run;result.checks_failed+=parsed.checks_failed;Object.assign(result.metrics,parsed.metrics);
      if(type==='performance') {
        const config=JSON.parse(await fs.readFile(path.join(root,'harness/config.json'),'utf8'));
        const maximum=config.metrics?.add_member_builds_max?.max;
        if(!Number.isFinite(maximum))throw Error('Missing fixed build budget');
        result.checks_run++;
        if(parsed.metrics.add_member_builds_max>maximum){result.checks_failed++;console.error('Build budget exceeded: '+parsed.metrics.add_member_builds_max+' > '+maximum);}
      }
      if(runResult.code!==0)exit=1;
    }
  }catch(error){console.error(error);result.checks_failed++;exit=1;}
  if(!result.checks_run)exit=1;
  if(process.env.HARNESS_RUN_DIR)await fs.writeFile(path.join(process.env.HARNESS_RUN_DIR,'result.json'),JSON.stringify(result,null,2));
  console.log('PROJECT_RESULT '+JSON.stringify(result));
  return exit||Number(result.checks_failed>0);
}
module.exports={unitResult,browserResult,pipelineResult};
if(require.main===module)main(process.argv[2]).then(code=>{process.exitCode=code;}).catch(error=>{console.error(error);process.exitCode=1;});
