const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const Model = require('../src/assets/family-model.js');
const Commands = require('../src/assets/family-commands.js');
const Lifecycle = require('../src/assets/family-lifecycle.js');
const Diff = require('../src/assets/family-diff.js');
const Evidence = require('../src/assets/relationship-evidence.js');
const { createFamilyServer } = require('../dev/server.cjs');
const time = '2026-10-11T08:00:00.000Z';
const p = (id, relationships = []) => ({ id,name:id,gender:'U',location:'',position:'',siblingOrder:null,relationships });
const clone = value => JSON.parse(JSON.stringify(value));
const parent = id => ({ type:'parent',personId:id,kind:'親生',status:'confirmed' });
const data = () => ({ schemaVersion:3,extension:{ retained:true },people:[p('G'),p('P',[parent('G')]),p('C',[parent('P')]),p('S',[parent('P')])] });
const run = (input,type,id,extra = {}) => Commands.apply(input,{ type,id,now:time,...extra }).data;

test('v2 upgrade preserves original values and extensions, supports v3 no-op, rejects incompatible versions', () => {
  const old = { ...data(),schemaVersion:2 };
  old.people[1].extension = { untouched:['原始資料'] };
  const saved = clone(old), migrated = Model.upgradeSchema(old);
  assert.equal(migrated.schemaVersion,3);
  assert.deepEqual({ ...migrated,schemaVersion:2 },saved);
  assert.deepEqual(old,saved);
  assert.equal(Model.upgradeSchema(migrated),migrated);
  assert.equal(Commands.apply(old,{ type:'migrateSchema' }).backupBeforeMigration,true);
  assert.throws(() => Model.build({ ...old,schemaVersion:4 }),/版本/);
  assert.throws(() => Model.build({ ...old,recycleBin:[] }),/版本 3/);
});

test('archive and unarchive preserve relationships, location metadata, inference and member extensions', () => {
  const original = Model.completeKinship(data()), before = clone(original);
  const archived = run(original,'archiveMember','P',{ reason:' 暫時保留 ' });
  assert.deepEqual(archived.people.find(p => p.id === 'P').archive,{ archivedAt:time,reason:'暫時保留' });
  assert.equal(archived.people.length,original.people.length);
  assert.deepEqual(archived.people.find(p => p.id === 'P').relationships,original.people.find(p => p.id === 'P').relationships);
  assert.deepEqual(archived.people.find(p => p.id === 'C').inferredRelationships,original.people.find(p => p.id === 'C').inferredRelationships);
  assert.equal(Commands.apply(archived,{ type:'archiveMember',id:'P' }).unchanged,true);
  assert.deepEqual(run(archived,'unarchiveMember','P'),original);
  assert.deepEqual(original,before);
});

test('deleting an intermediate member cleans all references and inference without creating new direct links', () => {
  const original = Model.completeKinship(data()), before = clone(original);
  original.ignoredIntermediatePlans = ['grandparent|P|G|親生','grandparent|C|G|親生'];
  const preview = Lifecycle.preview(original,{ type:'deleteMember',id:'P',now:time },Model);
  assert.equal(preview.canApply,true);
  assert.deepEqual(new Set(preview.affectedPersonIds),new Set(['P','G','C','S']));
  assert.equal(original.people.length,4,'preview does not commit');
  const deleted = preview.data;
  assert(!deleted.people.some(p => p.id === 'P'));
  assert(deleted.people.every(p => !p.relationships.some(r => r.personId === 'P')));
  assert(deleted.people.every(p => !p.inferredRelationships?.length));
  assert.equal(deleted.recycleBin[0].incomingRelationships.length,2);
  assert(!Object.hasOwn(deleted.recycleBin[0].person,'inferredRelationships'));
  assert.deepEqual(deleted.ignoredIntermediatePlans,['grandparent|C|G|親生']);
  deleted.people.find(p => p.id === 'G').notes = '刪除後的新修改';
  const restored = run(deleted,'restoreMember','P');
  assert.equal(restored.people.find(p => p.id === 'G').notes,'刪除後的新修改');
  assert.deepEqual(restored.people.find(p => p.id === 'P').relationships,before.people.find(p => p.id === 'P').relationships);
  assert(restored.people.find(p => p.id === 'C').inferredRelationships.length);
  assert.deepEqual(restored.recycleBin,[]);
});

test('restore blocks missing people and ID collisions; explicit relationship omissions do not restore invalid edges', () => {
  const first = run(data(),'deleteMember','P'), second = run(first,'deleteMember','C');
  const preview = Lifecycle.preview(second,{ type:'restoreMember',id:'P' },Model);
  assert.equal(preview.canApply,false);
  assert(preview.conflicts.some(c => c.kind === 'relationship'));
  assert.throws(() => run(second,'restoreMember','P'),/已不存在/);
  const restored = run(second,'restoreMember','P',{ omitRelationships:preview.conflicts.filter(c => c.kind === 'relationship').map(c => c.key) });
  assert(restored.people.every(p => p.relationships.every(r => restored.people.some(q => q.id === r.personId))));
  const collision = { ...first,people:[...first.people,p('P')] };
  assert.equal(Lifecycle.preview(collision,{ type:'restoreMember',id:'P' },Model).data,null);
  assert.throws(() => run(collision,'restoreMember','P'),/ID 已被使用/);
  assert.throws(() => run(first,'restoreMember','P',{ omitRelationships:['unknown'] }),/重新預覽/);
});

test('rank member restoration checks occupied rank and can omit the group without leaving groupId references', () => {
  const original = { schemaVersion:3,people:[p('A',[{ type:'sibling',personId:'B',groupId:'r' }]),p('B'),p('D')],
    rankGroups:[{ id:'r',name:'同胞',type:'sibling',members:[{ personId:'A',order:1 },{ personId:'B',order:2 }] }] };
  const deleted = run(original,'deleteMember','A');
  assert.deepEqual(deleted.rankGroups[0].members,[{ personId:'B',order:2 }]);
  const restored = run(deleted,'restoreMember','A');
  assert.deepEqual(restored.rankGroups[0].members,[{ personId:'B',order:2 },{ personId:'A',order:1 }]);
  deleted.rankGroups[0].members.push({ personId:'D',order:1 });
  const preview = Lifecycle.preview(deleted,{ type:'restoreMember',id:'A' },Model);
  assert.equal(preview.canApply,false);
  assert(preview.conflicts.some(c => /排行已被使用/.test(c.message)));
  const omitted = run(deleted,'restoreMember','A',{ omitGroups:['r'] });
  assert(!Object.hasOwn(omitted.people.find(p => p.id === 'A').relationships[0],'groupId'));
  assert(!omitted.rankGroups[0].members.some(m => m.personId === 'A'));
  deleted.rankGroups[0].type = 'swornSibling';
  assert(Lifecycle.preview(deleted,{ type:'restoreMember',id:'A' },Model).conflicts.some(c => /類型已改變/.test(c.message)));
});

test('deleting and restoring a rank anchor preserves current group changes and blocks changed anchors', () => {
  const original = { schemaVersion:3,people:[p('A'),p('B'),p('C')],rankGroups:[{ id:'r',name:'排行',type:'sibling',anchorId:'A',members:[{ personId:'B',order:1 }] }] };
  const deleted = run(original,'deleteMember','A');
  assert(!Object.hasOwn(deleted.rankGroups[0],'anchorId'));
  deleted.rankGroups[0].name = '新的名稱';
  assert.equal(run(deleted,'restoreMember','A').rankGroups[0].name,'新的名稱');
  deleted.rankGroups[0].anchorId = 'C';
  assert.equal(Lifecycle.preview(deleted,{ type:'restoreMember',id:'A' },Model).canApply,false);
  assert.equal(run(deleted,'restoreMember','A',{ omitGroups:['r'] }).rankGroups[0].anchorId,'C');
});

test('invalid archive and recycle payloads fail validation before writing', () => {
  const invalid = data(); invalid.people[0].archive = { archivedAt:'invalid' };
  assert.throws(() => Model.build(invalid),/封存/);
  assert.throws(() => Model.build({ schemaVersion:3,people:[null] }),/成員/);
  const deleted = run(data(),'deleteMember','P');
  deleted.recycleBin.push(clone(deleted.recycleBin[0]));
  assert.throws(() => Model.build(deleted),/回收資料/);
  const badArchive = run(data(),'deleteMember','P'); badArchive.recycleBin[0].person.archive = { archivedAt:time,reason:'x'.repeat(2001) };
  assert.throws(() => Model.build(badArchive),/封存/);
});

test('editing an archived member retains archive metadata and background results skip it', () => {
  const archived = run(data(),'archiveMember','P');
  const member = clone(archived.people.find(p => p.id === 'P')); member.notes = '仍可修改';
  assert.deepEqual(Commands.apply(archived,{ type:'updateMember',id:'P',member }).data.people.find(p => p.id === 'P').archive,member.archive);
  archived.people.find(p => p.id === 'P').location = '臺北市';
  const result = require('../src/assets/family-location.js').resolve('臺北市',[],10);
  assert.equal(Commands.apply(archived,{ type:'updateLocations',query:'臺北市',result }).unchanged,true);
});

test('structured differences use stable IDs and normalize reversed relationships and long/extension values', () => {
  const before = { schemaVersion:3,people:[p('A',[{ type:'sibling',personId:'B',seniority:'older',source:'族譜',status:'confirmed' }]),p('B')] };
  before.people.forEach(p => { p.name = '同名'; });
  const reversed = clone(before); reversed.people[0].relationships = []; reversed.people[1].relationships = [{ type:'sibling',personId:'A',seniority:'younger',source:'族譜',status:'confirmed' }];
  assert.equal(Diff.compare(before,reversed).total,0);
  const after = clone(reversed); after.people[1].notes = '長備註'.repeat(200); after.people[1].extension = { value:2 }; after.custom = '新增設定';
  const differences = Diff.compare(before,after);
  assert.equal(differences.summary.member.changed,1);
  assert(differences.items.filter(i => i.entity === 'member').every(i => i.entityId === 'B'));
  assert(differences.items.filter(i => i.entity === 'member').every(i => i.label.includes('ID：B')),'same names remain distinguishable in the preview');
  assert(differences.items.some(i => i.field === 'extension'));
  assert(differences.items.some(i => i.field === 'custom'));
  after.people[1].relationships[0].status = 'pending';
  assert(!Diff.compare(before,after).items.some(i => i.field === 'status'));
  after.people[1].relationships[0].note = '新增說明';
  assert.equal(Diff.compare(before,after).items.find(i => i.field === 'note').after,'新增說明');
  assert.match(Diff.lines(before,after).join('\n'),/修改關係/);
});

test('differences ignore legacy confirmation, inferred caches and group member display order', () => {
  const before = { schemaVersion:3,people:[p('A',[{ type:'spouse',personId:'B' }]),p('B')],rankGroups:[{ id:'r',name:'群組',type:'swornSibling',members:[{ personId:'A',order:1 },{ personId:'B',order:2 }] }] };
  const after = clone(before); after.people[0].inferredRelationships = [{ arbitrary:'cache' }]; after.rankGroups[0].members.reverse();
  assert.equal(Diff.compare(before,after).total,0);
  after.people[0].relationships[0].status = 'confirmed';
  assert.equal(Diff.compare(before,after).total,0);
  after.schemaVersion = 2; after.people[0].geocode = { arbitrary:'comparison-only' };
  assert.equal(Diff.compare(before,after).items.filter(i => i.system).length,2);
});

test('archive, recycle, relationship removals and group changes appear in structured differences', () => {
  const before = data(), archived = run(before,'archiveMember','P');
  assert(Diff.compare(before,archived).items.some(i => i.field === 'archive'));
  const deleted = run(archived,'deleteMember','P'), result = Diff.compare(archived,deleted);
  assert.equal(result.summary.member.removed,1);
  assert.equal(result.summary.relationship.removed,3);
  assert.equal(result.summary.recycle.added,1);
});

test('evidence resolves reverse records while legacy confirmation has no presentation state', () => {
  const input = { schemaVersion:3,people:[p('A',[parent('B')]),p('B',[{ type:'child',personId:'A',kind:'親生' }])] };
  const relation = { type:'parent',personId:'B',kind:'親生' };
  assert.equal(Evidence.describe(input,'A',relation).records.length,2);
  input.people[1].relationships[0].status = 'pending';
  assert.equal(Evidence.text(Evidence.describe(input,'A',relation)),'直接記錄');
  delete input.people[0].relationships[0].status; delete input.people[1].relationships[0].status;
  assert(!('status' in Evidence.describe(input,'A',relation)));
  assert.equal(Evidence.describe(input,'A',relation).origin,'direct');
});

test('conflicting inverse metadata is displayed completely and never flattened to an object label', () => {
  const before = { schemaVersion:3,people:[p('A',[{ type:'spouse',personId:'B',source:'族譜' }]),p('B')] };
  const after = clone(before); after.people[1].relationships = [{ type:'spouse',personId:'A',source:'訪談' }];
  const change = Diff.compare(before,after).items.find(i => i.field === 'source');
  const text = Diff.format(change.after,'source');
  assert.match(text,/雙向記錄不一致/); assert.match(text,/族譜/); assert.match(text,/訪談/);
  assert.equal(Evidence.describe(after,'A',before.people[0].relationships[0]).records.length,2);
});

test('inferred evidence reflects every path premise without depending on legacy status', () => {
  const input = Model.completeKinship(data());
  const relation = input.people.find(p => p.id === 'C').inferredRelationships.find(r => r.type === 'grandparent');
  const full = Evidence.describe(input,'C',relation);
  assert.equal(full.origin,'inferred'); assert.equal(full.premises.length,2);
  delete input.people.find(p => p.id === 'P').relationships[0].status;
  assert.equal(Evidence.describe(input,'C',relation).records.length,2);
  input.people.find(p => p.id === 'P').relationships[0].status = 'pending';
  assert(!('statusLabel' in Evidence.describe(input,'C',relation)));
  assert.equal(Evidence.describe(input,'C',{ type:'spouse',personId:'G',status:'confirmed' }).records.length,0);
  assert(Model.completeKinship(input).people.find(p => p.id === 'C').inferredRelationships?.some(r => r.type === 'grandparent'));
});

test('dev API migrates once with raw backup, previews without mutation, blocks stale commands and restores after restart', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(),'family-lifecycle-'));
  const dataFile = path.join(dir,'family.json'), old = { ...data(),schemaVersion:2 };
  await fs.writeFile(dataFile,JSON.stringify(old));
  let server = createFamilyServer({ dataFile });
  const start = async () => { await new Promise(r => server.listen(0,'127.0.0.1',r)); return `http://127.0.0.1:${server.address().port}`; };
  let base = await start();
  const read = async () => (await fetch(base + '/api/family')).json();
  const send = async (body,route = '/api/family/lifecycle') => {
    const response = await fetch(base + route,{ method:'POST',headers:{ 'Content-Type':'application/json',Origin:base },body:JSON.stringify(body) });
    return { status:response.status,payload:await response.json() };
  };
  try {
    const first = await read(); assert.equal(first.data.schemaVersion,3); assert.equal(first.undoLabel,null);
    assert.deepEqual(JSON.parse(await fs.readFile(dataFile + '.schema-v2.backup.json','utf8')),old);
    const text = await fs.readFile(dataFile,'utf8');
    const preview = await send({ type:'deleteMember',id:'P',version:first.version,now:time,preview:true });
    assert.equal(preview.status,200); assert.equal(preview.payload.canApply,true);
    assert.equal(await fs.readFile(dataFile,'utf8'),text);
    const archived = await send({ type:'archiveMember',id:'P',version:first.version,now:time });
    assert.equal(archived.status,200);
    assert.equal((await send({ type:'deleteMember',id:'P',version:first.version })).status,409);
    const deleted = await send({ type:'deleteMember',id:'P',version:archived.payload.version,now:time });
    assert.equal(deleted.status,200); assert.equal(deleted.payload.data.recycleBin.length,1);
    const undo = await send({ version:deleted.payload.version },'/api/family/undo'); assert.equal(undo.status,200);
    assert(undo.payload.data.people.find(p => p.id === 'P').archive);
    const again = await send({ type:'deleteMember',id:'P',version:undo.payload.version,now:time });
    await new Promise(r => server.close(r)); server = createFamilyServer({ dataFile }); base = await start();
    const loaded = await read(); assert.deepEqual(loaded.data,again.payload.data);
    const restored = await send({ type:'restoreMember',id:'P',version:loaded.version });
    assert.equal(restored.status,200); assert(restored.payload.data.people.find(p => p.id === 'P').archive);
    assert.deepEqual(JSON.parse(await fs.readFile(dataFile + '.schema-v2.backup.json','utf8')),old,'first backup survives all edits');
    const imported = await send({ version:restored.payload.version,data:old },'/api/family/import'); assert.equal(imported.status,200);
    const backup = await (await fetch(base + '/api/family/schema-backup?kind=import')).json(); assert.deepEqual(backup.data,old);
  } finally { await new Promise(r => server.close(r)); await fs.rm(dir,{ recursive:true,force:true }); }
});
