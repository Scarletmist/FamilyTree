const test=require('node:test');
const assert=require('node:assert/strict');
const {unitResult,browserResult,pipelineResult}=require('../scripts/project-validation.cjs');
test('project adapter counts executed tests and rejects missing or zero evidence',()=>{
  const tap='# tests 5\n# skipped 1\n# fail 1\n# cancelled 1\n';
  assert.deepEqual(unitResult(tap),{checks_run:4,checks_failed:2,metrics:{}});
  assert.throws(()=>unitResult('process exited 0'),/summary/);
  assert.throws(()=>unitResult('# tests 1\n# skipped 1\n# fail 0\n# cancelled 0\n'),/No executed/);
  assert.throws(()=>unitResult(tap+tap),/ambiguous/);
});
test('browser adapter cannot turn a crashed suite or empty run into success',()=>{
  assert.deepEqual(browserResult('PASS first\nFAIL second\n',1),{checks_run:2,checks_failed:1,metrics:{}});
  assert.equal(browserResult('PASS first\n',1).checks_failed,1);
  assert.throws(()=>browserResult('',0),/No executed/);
});
test('performance adapter requires real cases and a finite build metric',()=>{
  assert.throws(()=>pipelineResult(''),/Missing/);
  assert.throws(()=>pipelineResult('PIPELINE_RESULT '+JSON.stringify({checks_run:0,checks_failed:0,metrics:{add_member_builds_max:0}})),/Invalid/);
  assert.throws(()=>pipelineResult('PIPELINE_RESULT '+JSON.stringify({checks_run:1,checks_failed:0,metrics:{add_member_builds_max:null}})),/Invalid/);
  const measured={checks_run:1,checks_failed:0,metrics:{add_member_builds_max:4},cases:[{size:100,samples:[{loadedMembers:100,builds:4,durationMs:12}]}]};
  assert.equal(pipelineResult('PIPELINE_RESULT '+JSON.stringify(measured)).checks_run,1);
  const empty=structuredClone(measured);empty.cases[0].samples[0].loadedMembers=0;
  assert.throws(()=>pipelineResult('PIPELINE_RESULT '+JSON.stringify(empty)),/Invalid fixture/);
  const inconsistent=structuredClone(measured);inconsistent.metrics.add_member_builds_max=3;
  assert.throws(()=>pipelineResult('PIPELINE_RESULT '+JSON.stringify(inconsistent)),/does not match/);
});
