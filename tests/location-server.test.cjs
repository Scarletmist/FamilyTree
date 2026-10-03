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
