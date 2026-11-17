const test=require('node:test');
const assert=require('node:assert/strict');
const Model=require('../src/assets/family-model.js');
const {performanceFixture}=require('./helpers/performance-fixture.cjs');
for(const shape of ['households','cohorts'])test('performance fixture loads valid nonempty '+shape+' at every declared size',()=>{
  for(const size of [100,500,1000]) {
    const data=performanceFixture(size,shape),before=JSON.stringify(data),graph=Model.build(data);
    assert.equal(data.people.length,size);assert.equal(graph.people.length,size);
    assert.equal(new Set(data.people.map(p=>p.id)).size,size);
    assert(data.people.some(p=>p.relationships.some(r=>r.type==='parent'&&r.kind==='親生')));
    assert(graph.descents.length>0); assert(graph.unions.length>0);
    assert.equal(JSON.stringify(data),before);
  }
});
