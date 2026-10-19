const test = require('node:test');
const assert = require('node:assert/strict');
const Maintenance = require('../src/assets/family-maintenance.js');
const Model = require('../src/assets/family-model.js');
const Commands = require('../src/assets/family-commands.js');
const Lifecycle = require('../src/assets/family-lifecycle.js');
const Location = require('../src/assets/family-location.js');
const p = (id,relationships = [],extra = {}) => ({ id,name:id,gender:'U',location:'',position:'',siblingOrder:null,relationships,...extra });
const archive = { archivedAt:'2026-10-11T00:00:00Z' };
const parent = personId => ({ type:'parent',personId,kind:'親生' });
test('maintenance classifies unlinked members from inbound and outbound relationships, excluding archived records',() => {
  const data = { schemaVersion:3,people:[p('A',[parent('B')]),p('B'),p('C'),p('Z',[],{ archive })] };
  assert.deepEqual(Maintenance.tasks(data).items.filter(i => i.category === 'unlinked').map(i => i.ownerId),['C']);
  const input = JSON.stringify(data); Maintenance.tasks(data); assert.equal(JSON.stringify(data),input);
});
test('legacy confirmation flags do not create a maintenance category or tasks',() => {
  const data = { schemaVersion:3,people:[p('A',[{ type:'sibling',personId:'B',status:'pending',source:'訪談' }]),p('B',[{ type:'sibling',personId:'A',status:'pending' }]),p('Z',[],{ archive })] };
  const before = JSON.stringify(data),tasks = Maintenance.tasks(data);
  assert(!('pending' in tasks.counts)); assert(!tasks.items.some(i => i.category === 'pending'));
  assert.equal(JSON.stringify(data),before); assert.equal(Object.keys(Maintenance.categories).length,4);
});
test('intermediate tasks share slots, respect ignored plans and omit archived endpoints',() => {
  const data = { schemaVersion:3,people:[p('A',[{ type:'sibling',personId:'B' }]),p('B')] };
  const plan = Model.intermediatePlans(data)[0]; assert.equal(Maintenance.tasks(data).counts.intermediate,1);
  const ignored = Commands.apply(data,{ type:'updateIntermediateIgnore',planId:plan.id,ignored:true }).data;
  assert.equal(Maintenance.tasks(ignored).counts.intermediate,0);
  data.people[0].archive = archive; assert.deepEqual(Model.intermediatePlans(data),[]);
  const shared = { schemaVersion:3,people:[p('P'),p('B',[parent('P')]),p('C',[parent('P'),{ type:'sibling',personId:'B' }]),
    p('A',[{ type:'tangCousin',personId:'B' },{ type:'tangCousin',personId:'C' }])] };
  assert.equal(Model.intermediatePlans(shared).length,2);
  assert.equal(Maintenance.tasks(shared).counts.intermediate,1,'two suggestions for the same father are one task');
});
test('location tasks explain failures and exclude privacy, archives, empty optional fields and manual corrections',() => {
  const data = { schemaVersion:3,people:[p('N',[],{ location:'臺北市',geocode:Location.resolve('臺北市',[],1) }),
    p('Q',[],{ location:'臺南市' }),p('H',[],{ location:'住宅' }),p('Z',[],{ location:'高雄市',archive }),p('E'),
    p('M',[],{ location:'新竹市',locationOverride:{ source:'map',location:'新竹市',displayName:'手動位置',lat:24,lon:121,updatedAt:1 } })] };
  const result = Maintenance.tasks(data,{ locationState:{ kind:'retry',query:'臺南市' } });
  assert.equal(result.counts.location,2);
  assert.match(result.items.find(i => i.category === 'location' && i.ownerId === 'N').reason,/查無/);
  assert.match(result.items.find(i => i.category === 'location' && i.ownerId === 'Q').reason,/查詢失敗/);
});
test('duplicate candidates normalize names, show matching-location evidence, and preserve distinct IDs without merging',() => {
  const data = { schemaVersion:3,people:[p('A',[],{ name:'Ａ 明',location:'臺北市' }),p('B',[],{ name:'A明',location:'臺北市' }),p('Z',[],{ name:'A明',archive })] };
  const before = JSON.stringify(data), result = Maintenance.tasks(data);
  assert.equal(result.counts.duplicate,1); const candidate = result.items.find(i => i.category === 'duplicate');
  assert.deepEqual(candidate.personIds,['A','B']); assert.match(candidate.reason,/所在地也相同/); assert.equal(JSON.stringify(data),before);
});
test('archiving retains geocode/override while suppressing effective map position, queue and stale correction writes',() => {
  const person = p('A',[],{ location:'臺北市',geocode:Location.resolve('臺北市',[],1),
    locationOverride:{ source:'map',location:'臺北市',displayName:'手動位置',lat:25,lon:121,updatedAt:1 } });
  const data = { schemaVersion:3,people:[person] }, archived = Commands.apply(data,{ type:'archiveMember',id:'A' }).data;
  assert(Location.eligible(archived.people[0])); assert(!Location.locatable(archived.people[0])); assert.equal(Location.effective(archived.people[0]),null);
  assert.deepEqual(archived.people[0].geocode,person.geocode); assert.deepEqual(archived.people[0].locationOverride,person.locationOverride);
  const queue = Location.createQueue({ people:() => archived.people,lookup:async () => [],save:async () => {} }); assert.deepEqual(queue.pending(),[]);
  assert.throws(() => Commands.apply(archived,{ type:'clearLocationOverride',id:'A',expectedLocation:person.location,expectedOverride:person.locationOverride }),/已封存/);
  const restored = Commands.apply(archived,{ type:'unarchiveMember',id:'A' }).data; assert(Location.effective(restored.people[0]));
  assert.equal(Commands.apply(archived,{ type:'resetLocation',id:'A' }).unchanged,true);
  const shared = { ...archived,people:[...archived.people,p('B',[],{ location:'臺北市',geocode:person.geocode })] };
  const reset = Commands.apply(shared,{ type:'resetLocation',id:'B' }).data;
  assert.deepEqual(reset.people[0].geocode,person.geocode,'retrying a shared place preserves archived coordinates');
});
test('restore permits explicit omission of obsolete numeric ranks and keeps the newer family intact',() => {
  const original = { schemaVersion:3,people:[p('P'),p('A',[parent('P')],{ siblingOrder:1 }),p('B',[parent('P')],{ siblingOrder:2 })] };
  const deleted = Commands.apply(original,{ type:'deleteMember',id:'A' }).data; deleted.people.find(p => p.id === 'B').siblingOrder = 1;
  assert.equal(Lifecycle.preview(deleted,{ type:'restoreMember',id:'A' },Model).canApply,false);
  const restored = Commands.apply(deleted,{ type:'restoreMember',id:'A',clearOrders:['siblingOrder'] }).data;
  assert.equal(restored.people.find(p => p.id === 'A').siblingOrder,null); assert.equal(restored.people.find(p => p.id === 'B').siblingOrder,1);
  assert.throws(() => Commands.apply(deleted,{ type:'restoreMember',id:'A',clearOrders:['name'] }),/重新預覽/);
});
test('deletion impact includes descendants whose inferred paths disappear and does not add direct links',() => {
  const data = { schemaVersion:3,people:[p('G'),p('P',[parent('G')]),p('C',[parent('P')]),p('D',[parent('C')])] };
  const preview = Lifecycle.preview(data,{ type:'deleteMember',id:'P' },Model);
  assert(preview.affectedPersonIds.includes('D'));
  assert.deepEqual(preview.data.people.find(p => p.id === 'D').relationships,[parent('C')]);
});
test('active geocoding is aborted when its last eligible member is archived, preserving shared queries until then',async () => {
  const people = [p('A',[],{ location:'臺北市' }),p('B',[],{ location:'臺北市' })];
  const scheduled = []; let signal,saves = 0;
  const queue = Location.createQueue({ people:() => people,schedule:fn => { scheduled.push(fn); return scheduled.length; },cancel:() => {},
    lookup:async (query,current) => { signal = current; return new Promise((resolve,reject) => current.addEventListener('abort',() => reject(current.reason),{ once:true })); },save:async () => { saves++; } });
  queue.wake(); scheduled.shift()(); await new Promise(r => setImmediate(r)); assert(signal);
  people[0].archive = archive; queue.wake(); assert.equal(signal.aborted,false);
  people[1].archive = archive; queue.wake(); assert.equal(signal.aborted,true);
  await new Promise(r => setImmediate(r)); assert.equal(saves,0); assert.deepEqual(queue.pending(),[]); queue.stop();
});
