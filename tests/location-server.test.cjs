const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createFamilyServer } = require('../dev/server.cjs');
const Location = require('../src/assets/family-location.js');
test('dev coordinate adapter persists latest member edits and retains user undo history', async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'location-server-'));
  const member={id:'A',name:'原名',location:'新竹天公壇',position:'',gender:'U',siblingOrder:null,relationships:[]};
  const dataFile=path.join(dir,'family.json');await fs.writeFile(dataFile,JSON.stringify({schemaVersion:2,people:[member]}));
  const server=createFamilyServer({dataFile});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  const send=async(url,body,method='POST')=>{
    const response=await fetch(base+url,{method,headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify(body)});
    return {status:response.status,data:await response.json()};
  };
  try {
    const response=await fetch(base+'/api/family');const original=await response.json();
    assert.equal(response.headers.get('referrer-policy'),'strict-origin-when-cross-origin');
    const edit=await send('/api/members/A',{version:original.version,member:{...member,name:'改名',notes:'保留備註'}},'PUT');assert.equal(edit.status,200);
    const geocode=Location.resolve('新竹天公壇',[{name:'新竹天公壇',display_name:'新竹天公壇, 新竹市',lat:'24.7995492',lon:'120.9586319',osm_type:'way',osm_id:341205717}]);
    const located=await send('/api/family/locations',{type:'updateLocations',query:'新竹天公壇',result:geocode});assert.equal(located.status,200);
    assert.equal(located.data.data.people[0].name,'改名');assert.equal(located.data.data.people[0].notes,'保留備註');
    assert.equal(located.data.undoLabel,edit.data.undoLabel);
    const stale=await send('/api/members/A',{version:edit.data.version,member:{...member,name:'過期編輯'}},'PUT');assert.equal(stale.status,409);
    const bad=await send('/api/family/locations',{type:'updateLocations',query:'新竹天公壇',result:{...geocode,lat:999}});assert.equal(bad.status,400);
    const undo=await send('/api/family/undo',{version:located.data.version});assert.equal(undo.status,200);assert.equal(undo.data.data.people[0].name,'原名');
    const disk=JSON.parse(await fs.readFile(dataFile,'utf8'));assert.equal(disk.people[0].name,'原名');
  } finally { await new Promise(resolve=>server.close(resolve)); await fs.rm(dir,{recursive:true,force:true}); }
});

test('dev corrections preserve personal positions, reject stale saves and support restore/undo/export', async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'location-correction-server-'));
  const member={id:'A',name:'成員',location:'關帝廟',position:'',gender:'U',siblingOrder:null,relationships:[]};
  const dataFile=path.join(dir,'family.json');await fs.writeFile(dataFile,JSON.stringify({schemaVersion:2,people:[member,{...member,id:'B'}]}));
  const server=createFamilyServer({dataFile});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  const send=async(body,url='/api/family/locations')=>{
    const response=await fetch(base+url,{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify(body)});
    return {status:response.status,data:await response.json()};
  };
  try {
    const initial=await (await fetch(base+'/api/family')).json();
    const override={source:'map',location:'關帝廟',lat:24.8028,lon:120.9665,displayName:'地圖指定位置',updatedAt:10};
    const command={type:'setLocationOverride',id:'A',expectedVersion:initial.version,expectedLocation:'關帝廟',expectedOverride:null,override};
    const saved=await send(command);assert.equal(saved.status,200);assert.match(saved.data.undoLabel,/修正/);
    assert.equal(saved.data.data.people[1].locationOverride,undefined);
    assert.equal((await send(command)).status,409,'a stale version cannot replace a correction');
    const auto=Location.resolve('關帝廟',[{name:'關帝廟',display_name:'錯誤地點',lat:'25',lon:'121',osm_type:'way',osm_id:123}]);
    const located=await send({type:'updateLocations',query:'關帝廟',result:auto});assert.equal(located.status,200);
    assert.deepEqual(located.data.data.people[0].locationOverride,override);assert.equal(located.data.data.people[0].geocode,undefined);
    assert.equal(located.data.data.people[1].geocode.lat,25);assert.equal(located.data.undoLabel,saved.data.undoLabel);
    const exported=await (await fetch(base+'/api/family/export')).json();assert.deepEqual(exported.people[0].locationOverride,override);
    const restore=await send({type:'clearLocationOverride',id:'A',expectedVersion:located.data.version,expectedLocation:'關帝廟',expectedOverride:override});
    assert.equal(restore.status,200);assert.equal(restore.data.data.people[0].locationOverride,undefined);assert.match(restore.data.undoLabel,/恢復/);
    const undoRestore=await send({version:restore.data.version},'/api/family/undo');assert.equal(undoRestore.status,200);assert.deepEqual(undoRestore.data.data.people[0].locationOverride,override);
    const undoCorrection=await send({version:undoRestore.data.version},'/api/family/undo');assert.equal(undoCorrection.status,200);assert.equal(undoCorrection.data.data.people[0].locationOverride,undefined);
    const shared=await send({...command,expectedVersion:undoCorrection.data.version,applyToSameLocation:true,
      expectedRelatedMembers:[{id:'B',expectedLocation:'關帝廟',expectedOverride:null}]});
    assert.equal(shared.status,200);assert.match(shared.data.undoLabel,/2 位/);
    assert.deepEqual(shared.data.data.people.map(p=>p.locationOverride),[override,override]);
    const exportedShared=await (await fetch(base+'/api/family/export')).json();assert.deepEqual(exportedShared.people.map(p=>p.locationOverride),[override,override]);
    const onlyB=await send({type:'setLocationOverride',id:'B',expectedVersion:shared.data.version,expectedLocation:'關帝廟',expectedOverride:override,override:{...override,lat:25}});
    assert.equal(onlyB.status,200);assert.equal(onlyB.data.data.people[0].locationOverride.lat,24.8028);assert.equal(onlyB.data.data.people[1].locationOverride.lat,25);
    const undoB=await send({version:onlyB.data.version},'/api/family/undo');assert.equal(undoB.status,200);
    assert.deepEqual(undoB.data.data.people.map(p=>p.locationOverride),[override,override]);
    const undoShared=await send({version:undoB.data.version},'/api/family/undo');assert.equal(undoShared.status,200);
    assert(undoShared.data.data.people.every(p=>p.locationOverride===undefined),'one undo restores the whole shared correction');
  } finally {await new Promise(resolve=>server.close(resolve));await fs.rm(dir,{recursive:true,force:true});}
});
