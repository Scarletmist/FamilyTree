// Deterministic source records: small households and denser sibling cohorts.
function performanceFixture(size, shape) {
  if (!Number.isInteger(size) || size < 4 || !['households','cohorts'].includes(shape)) throw new Error('Invalid fixture parameters');
  const people = [], width = shape === 'households' ? 12 : 48;
  const person = (id,gender,relationships=[]) => ({id,name:id,gender,location:'',position:'',siblingOrder:null,relationships});
  for (let offset=0;offset<size;offset+=width) {
    const count=Math.min(width,size-offset), a='p'+offset,b='p'+(offset+1);
    people.push(person(a,'M',count>1?[{type:'spouse',personId:b}]:[]));
    if(count>1)people.push(person(b,'F'));
    for(let i=2;i<count;i++)people.push(person('p'+(offset+i),i%2?'F':'M',[{type:'parent',personId:a,kind:'親生'},{type:'parent',personId:b,kind:'親生'}]));
  }
  return {schemaVersion:3,familyName:'Synthetic performance '+shape,locationLookupDeviceId:'test-device',people};
}
module.exports = {performanceFixture};
