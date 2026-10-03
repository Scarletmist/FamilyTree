const test = require('node:test');
const assert = require('node:assert/strict');
const Location = require('../src/assets/family-location.js');
const Commands = require('../src/assets/family-commands.js');
const Model = require('../src/assets/family-model.js');
const person = (id, location = '新竹天公壇') => ({ id, name:id, location, position:'', gender:'U', siblingOrder:null, relationships:[] });
const response = (name = '新竹天公壇') => [{ name, display_name:name + ', 新竹市', lat:'24.7995492', lon:'120.9586319', osm_type:'way', osm_id:341205717 }];
const result = () => Location.resolve('新竹天公壇', response(), 10);
function harness(items, options = {}) {
  const { lookup: unused, ...injections } = options;
  let data = {schemaVersion:2, people:items}, time = 0, calls = [], saves = [], timers = new Map(), id = 0;
  const cache = new Map();
  const queue = Location.createQueue({
    people: () => data.people, now: () => time,
    schedule: (fn, delay) => { timers.set(++id, { fn, at:time + delay }); return id; }, cancel: key => timers.delete(key),
    lookup: async query => { calls.push({query,time}); return options.lookup ? options.lookup(query, calls.length) : response(query); },
    save: async (query, result) => { saves.push(result); data = Commands.apply(data, {type:'updateLocations',query,result}).data; },
    cached: async key => cache.get(key), cache: async (key, value) => cache.set(key, value),
    ...injections
  });
  return {queue, calls, saves, data:()=>data, setData:next=>data=next,
    async advance(target) {
      for (;;) {
        const due = [...timers].filter(([,t])=>t.at<=target).sort((a,b)=>a[1].at-b[1].at)[0];
        if (!due) break;
        time=due[1].at; timers.delete(due[0]); due[1].fn();
        for (let n=0;n<30;n++) await Promise.resolve();
      }
      time=target;
    }
  };
}
test('landmark coordinates, malformed responses, ambiguity and negative results',()=>{
  assert(Location.valid(result()));
  assert.equal(Location.resolve('新竹天公壇', []).status,'not_found');
  assert.equal(Location.resolve('關帝廟', [...response('甲關帝廟'), ...response('乙關帝廟')]).status,'ambiguous');
  assert.equal(Location.resolve('新竹天公壇', [...response(), ...response('別處')]).status,'resolved');
  assert.throws(()=>Location.resolve('地點',[{...response()[0],lat:'NaN'}]));
  assert(!Location.valid({...result(),lat:100}));
  assert(!Location.valid({...result(),checkedAt:'10'}));
});
test('privacy preflight suppresses private input but accepts a public temple name',()=>{
  assert(Location.eligible(person('A')));
  assert(!Location.eligible({...person('A'),mapHidden:true}));
  assert(!Location.eligible(person('A','新竹市中山路431巷36號')));
  assert(!Location.eligible(person('A','123 Main Street')));
  assert(!Location.eligible(person('A','')));
});
test('coordinate writes preserve latest edits and ignore changed, hidden or deleted targets',()=>{
  const original = {...person('A'),name:'剛改的名字', notes:'保留備註',custom:{keep:true}};
  const data = {schemaVersion:2, people:[original,{...person('B'),mapHidden:true},person('C','新竹關帝廟')]};
  const change = Commands.apply(data,{type:'updateLocations',query:'新竹天公壇',result:result()});
  assert.equal(change.metadataOnly,true); assert.equal(change.data.people[0].name,'剛改的名字');
  assert.equal(change.data.people[0].notes,'保留備註'); assert.deepEqual(change.data.people[0].custom,{keep:true});
  assert.equal(change.data.people[1].geocode,undefined); assert.equal(change.data.people[2].geocode,undefined);
  assert.equal(original.geocode,undefined);
  assert.equal(Commands.apply({schemaVersion:2,people:[]},{type:'updateLocations',query:'新竹天公壇',result:result()}).unchanged,true);
  assert.throws(()=>Commands.apply(data,{type:'updateLocations',query:'新竹關帝廟',result:result()}));
});
test('location/privacy edits invalidate coordinates; ordinary edits retain them',()=>{
  const data = {schemaVersion:2,people:[{...person('A'),geocode:result()}]};
  const update = member => Commands.apply(data,{type:'updateMember',id:'A',member}).data.people[0];
  assert.equal(update({...person('A'),name:'改名'}).geocode.status,'resolved');
  assert.equal(update(person('A','新竹關帝廟')).geocode,undefined);
  assert.equal(update({...person('A'),mapHidden:true}).geocode,undefined);
  assert.throws(()=>Model.build({schemaVersion:2,people:[{...person('A'),mapHidden:'yes'}]}));
  assert.throws(()=>Model.build({schemaVersion:2,people:[{...person('A'),geocode:{...result(),lon:999}}]}));
});
test('merge associates coordinates with selected location and preserves privacy exclusions',()=>{
  const data={schemaVersion:2,people:[{...person('A'),geocode:result()},person('B','新竹關帝廟')]};
  assert.equal(Model.mergeMembers(data,'A','B',{location:'新竹關帝廟'}).people[0].geocode,undefined);
  data.people[1].mapHidden=true;
  assert.equal(Model.mergeMembers(data,'A','B').people[0].mapHidden,true);
  assert.equal(Model.mergeMembers(data,'A','B').people[0].geocode,undefined);
});
test('identical places share one query; background remains serial and spaced 15 seconds',async()=>{
  const h=harness([person('A'),person('B'),person('C','新竹關帝廟')]); h.queue.wake();
  await h.advance(0); assert.equal(h.calls.length,1); assert(h.data().people[1].geocode);
  await h.advance(14999); assert.equal(h.calls.length,1);
  await h.advance(15000); assert.equal(h.calls.length,2); assert.equal(h.calls[1].time,15000); h.queue.stop();
});
test('network failure retries the same query after exactly 5 seconds',async()=>{
  let n=0;
  const h=harness([person('A')],{lookup:async()=>{if(++n===1)throw new Error('network');return response();}});
  h.queue.wake(); await h.advance(0); assert.equal(n,1); assert.equal(h.saves.length,0);
  await h.advance(4999); assert.equal(n,1);
  await h.advance(5000); assert.equal(n,2); assert.equal(h.data().people[0].geocode.status,'resolved'); h.queue.stop();
});
test('empty search is terminal; paused queue resumes with priority and excludes private data',async()=>{
  let online=false;
  const h=harness([person('A'),{...person('B'),mapHidden:true},person('C','新竹關帝廟')],{available:()=>online,lookup:async()=>[]});
  h.queue.wake(); await h.advance(0); assert.equal(h.calls.length,0);
  online=true; h.queue.prioritize(['C']); await h.advance(0); assert.equal(h.calls[0].query,'新竹關帝廟');
  await h.advance(15000); assert.equal(h.calls.length,2); assert.equal(h.data().people[0].geocode.status,'not_found');
  await h.advance(60000); assert.equal(h.calls.length,2); h.queue.stop();
});
test('late results do not attach after location changes while the request is pending',async()=>{
  let finish;
  const h=harness([person('A')],{lookup:()=>new Promise(resolve=>finish=resolve)});
  h.queue.wake(); await h.advance(0);
  h.setData({schemaVersion:2,people:[person('A','新竹關帝廟')]}); finish(response());
  await h.advance(0); assert.equal(h.data().people[0].geocode,undefined); h.queue.stop();
});
test('device ownership is claimed once and changes only on explicit takeover',()=>{
  const owner=Commands.apply({schemaVersion:2,people:[]},{type:'claimLocationLookup',deviceId:'first'}).data;
  assert.equal(Commands.apply(owner,{type:'claimLocationLookup',deviceId:'second'}).unchanged,true);
  assert.equal(Commands.apply(owner,{type:'claimLocationLookup',deviceId:'second',takeOver:true}).data.locationLookupDeviceId,'second');
});

const manual = (location = '新竹天公壇', lat = 24.8028) => ({ source:'map', location, lat, lon:120.9665, displayName:'地圖指定位置', updatedAt:20 });
const correct = (data, id = 'A', override = manual()) => Commands.apply(data, { type:'setLocationOverride', id,
  expectedLocation:data.people.find(p=>p.id===id).location, expectedOverride:data.people.find(p=>p.id===id).locationOverride || null, override });
test('manual corrections are personal, undoable user data and protected from automatic writes/resets',async()=>{
  const data={schemaVersion:2,people:[person('A'),person('B')]};
  const correction=correct(data);
  assert.equal(correction.metadataOnly,undefined); assert.match(correction.label,/修正/);
  assert.deepEqual(correction.data.people[0].locationOverride,manual());
  assert.equal(correction.data.people[1].locationOverride,undefined);
  assert.deepEqual(Location.effective(correction.data.people[0]),manual());
  assert(!Model.sameJsonData(Location.content(data),Location.content(correction.data)));
  const located=Commands.apply(correction.data,{type:'updateLocations',query:'新竹天公壇',result:result()}).data;
  assert.equal(located.people[0].geocode,undefined);assert.equal(located.people[1].geocode.lat,result().lat);
  const reset=Commands.apply(located,{type:'resetLocation',id:'A'}).data;
  assert.deepEqual(reset.people[0].locationOverride,manual());
  const h=harness(correction.data.people);h.queue.wake();await h.advance(0);
  assert.equal(h.calls.length,1);assert.equal(h.data().people[1].geocode.lat,result().lat);
  assert.deepEqual(h.data().people[0].locationOverride,manual());h.queue.stop();
});
test('manual position validation and concurrent edit guards reject unsafe or stale updates',()=>{
  const data={schemaVersion:2,people:[person('A')]};
  for(const override of [manual('別處'),{...manual(),lat:NaN},{...manual(),lon:181},{...manual(),osmId:'123'},
    {...manual(),source:'nominatim'}, {...manual(),updatedAt:-1}]) assert.throws(()=>correct(data,'A',override));
  assert.throws(()=>correct({schemaVersion:2,people:[{...person('A'),mapHidden:true}]}));
  assert.throws(()=>correct({schemaVersion:2,people:[person('A','新竹市中山路1號')]}));
  assert.throws(()=>Commands.apply(data,{type:'setLocationOverride',id:'A',expectedLocation:'已變更',expectedOverride:null,override:manual()}),/已更新/);
  assert.throws(()=>Commands.apply(correct(data).data,{type:'clearLocationOverride',id:'A',expectedLocation:'新竹天公壇',expectedOverride:null}),/已更新/);
  assert.throws(()=>Model.build({schemaVersion:2,people:[{...person('A'),locationOverride:{...manual(),source:'google'}}]}));
});
test('ordinary edits retain overrides; location/privacy changes invalidate them; restoring auto affects one person',()=>{
  const data=correct({schemaVersion:2,people:[{...person('A'),geocode:result()},person('B')]}).data;
  const update=member=>Commands.apply(data,{type:'updateMember',id:'A',member}).data.people[0];
  assert.deepEqual(update({...person('A'),name:'改名'}).locationOverride,manual());
  assert.equal(update(person('A','新竹關帝廟')).locationOverride,undefined);
  assert.equal(update({...person('A'),mapHidden:true}).locationOverride,undefined);
  const restored=Commands.apply(data,{type:'clearLocationOverride',id:'A',expectedLocation:'新竹天公壇',expectedOverride:manual()});
  assert.equal(restored.data.people[0].locationOverride,undefined); assert.equal(restored.data.people[0].geocode,undefined);
  assert.deepEqual(restored.data.people[1],data.people[1]);assert.equal(restored.metadataOnly,undefined);
  assert.equal(Location.effective({...data.people[0],mapHidden:true}),null);
});
test('merge preserves matching manual coordinates, respects privacy and requires resolving conflicting overrides',()=>{
  const data={schemaVersion:2,people:[{...person('A'),locationOverride:manual()},person('B')]};
  assert.deepEqual(Model.mergeMembers(data,'B','A').people[0].locationOverride,manual());
  data.people[1].locationOverride=manual('新竹天公壇',25);
  assert.throws(()=>Model.mergeMembers(data,'A','B'),/手動修正位置不同/);
  assert.equal(Model.mergeMembers(data,'A','B',{location:'新竹關帝廟'}).people[0].locationOverride,undefined);
  data.people[1].mapHidden=true;
  assert.equal(Model.mergeMembers(data,'A','B').people[0].locationOverride,undefined);
});
test('candidate results retain full names and coordinates without inventing OSM identities for manual map points',()=>{
  const items=Location.candidates('新竹市關帝廟',[...response('別處'),...response('新竹關帝廟')],30);
  assert.equal(items.length,2);assert.equal(items[1].name,'新竹關帝廟');assert.equal(items[1].checkedAt,30);
  const selected={...manual(),source:'nominatim',query:items[1].query,displayName:items[1].displayName,osmType:items[1].osmType,osmId:items[1].osmId};
  assert(Location.validOverride(selected));assert(Location.validOverride(manual()));
  assert.deepEqual(Location.candidates('查無結果',[]),[]);
});

test('a background request already in flight cannot replace a later manual correction',async()=>{
  let finish;
  const h=harness([person('A')],{lookup:()=>new Promise(resolve=>finish=resolve)});
  h.queue.wake();await h.advance(0);
  h.setData(correct(h.data()).data);finish(response());await h.advance(0);
  assert.deepEqual(h.data().people[0].locationOverride,manual());assert.equal(h.data().people[0].geocode,undefined);
  assert.equal(h.queue.pending().length,0);h.queue.stop();
});
