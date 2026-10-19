const person = (id,name,relationships = [],extra = {}) => ({id,name,gender:'U',location:'',position:'',siblingOrder:null,relationships,...extra});
const relation = (type,personId,kind) => ({type,personId,...(kind ? {kind} : {}),status:kind === '親生' ? 'confirmed' : 'pending',source:'第五階段測試訪談',note:'關係資料說明 <原文>'});
const complexFixture = () => ({schemaVersion:3,familyName:'第五階段輸出驗證',people:[
  person('G','祖母'),person('P','封存銜接母親',[relation('parent','G','親生')],{archive:{archivedAt:'2026-10-12T00:00:00Z'}}),
  person('Q','父親',[relation('spouse','P'),relation('spouse','R')]),person('R','另一位配偶'),
  person('C','親生子女',[relation('parent','P','親生'),relation('parent','Q','親生')]),
  person('D','收養子女',[relation('parent','Q','養子女')]),person('E','過繼子女',[relation('parent','R','過繼')]),
  person('L',('完整長姓名測試'.repeat(12)).slice(0,80),[relation('grandparent','G','親生')]),
  person('T','師父',[relation('student','C')]),person('U','未連結'),
  person('Z','單獨封存',[],{archive:{archivedAt:'2026-10-12T00:00:00Z'}})
],recycleBin:[{id:'deleted',person:person('deleted','回收成員'),deletedAt:'2026-10-12T00:00:00Z',incomingRelationships:[],groupReferences:[],ignoredPlans:[]}]});
function performanceFixture(count) {
  // Small independent families bound sibling inference fan-out. This measures
  // ordinary family growth, not a synthetic thousand-sibling clique.
  return {schemaVersion:3,familyName:'效能測試',people:Array.from({length:count},(_,i) => {
    const group = Math.floor(i / 10) * 10,slot = i % 10;
    return person('N'+i,'效能成員'+i,slot === 0 ? [] : [relation('parent','N'+(slot < 3 ? group : group + 1),'親生')]);
  })};
}
module.exports = {complexFixture,performanceFixture};
