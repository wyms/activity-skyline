const test = require("node:test");
const assert = require("node:assert/strict");
const {calendar, importFile} = require("../site/calendar.js");
const geometry = require("../site/mesh.js");
const {makeKit} = require("../site/kit.js");
const {proofPixels} = require("../site/viewer.js");

test("dates map to Sunday-first weeks, including a 54-column leap year", () => {
  const c = calendar({year:2028,days:{"2028-01-01":1,"2028-01-02":2,"2028-12-31":3}});
  assert.equal(c.weeks.length,54);
  assert.equal(c.weeks[0][6],1); assert.equal(c.weeks[1][0],2); assert.equal(c.weeks[53][0],3);
  assert.deepEqual([c.total,c.active,c.peak],[6,3,3]);
});
test("offline files validate dates, counts and unique rows", () => {
  assert.equal(importFile("\uFEFFdate,count\r\n2024-02-29,3\r\n").total,3);
  assert.equal(importFile('{"year":2024,"days":{}}').total,0);
  for (const value of ["date,count\n2025-02-29,1","date,count\n2024-01-01,-1",
    "date,count\n2024-01-01,1\n2024-01-01,1","date,count\n2024-01-01,1\n2023-01-01,1",
    '{"year":2024,"days":{"2024-12-32":1}}','{"year":2024,"days":{"2024-01-01":0.5}}'])
    assert.throws(()=>importFile(value));
});
function unpack(bytes) {
  const data=Buffer.from(bytes), dictionary={};
  let pos=0;
  while(data.readUInt32LE(pos)===0x04034b50) {
    const size=data.readUInt32LE(pos+18), nameSize=data.readUInt16LE(pos+26),extra=data.readUInt16LE(pos+28);
    const start=pos+30+nameSize+extra, name=data.toString("utf8",pos+30,pos+30+nameSize);
    dictionary[name]=data.subarray(start,start+size);pos=start+size;
  }
  assert.equal(data.readUInt32LE(pos),0x02014b50);
  assert.equal(data.readUInt32LE(data.length-22),0x06054b50);
  return dictionary;
}
test("digital and physical kits contain valid STL payloads and use the selected finish and quantity",()=>{
  const data=calendar({year:2025,source:"private/team-one",days:{"2025-01-03":5}});
  const model=geometry.createModel({...data,label:"Studio 9"});
  const opts={finish:"Glacier",quantity:2,zipCode:"90210",isSample:false};
  const digital=unpack(makeKit(model,data,opts,geometry));
  assert.match(digital["print-guide.txt"].toString(),/private\/team-one/);
  assert.equal(digital["skyline.stl"].length,84+50*model.body.length);
  assert.equal(digital["end-cap.stl"].length,84+50*model.cap.length);
  assert(!digital["print-request.txt"]);
  const physical=unpack(makeKit(model,data,{...opts,physical:true},geometry));
  assert.match(physical["print-request.txt"].toString(),/2 complete desk pieces/);
  assert.match(physical["print-request.txt"].toString(),/Glacier.*charcoal/);
  assert.match(physical["print-request.txt"].toString(),/ZIP 90210/);
  assert.doesNotMatch(physical["print-guide.txt"].toString(),/private\/team-one/);
  assert.throws(()=>makeKit(model,data,{...opts,physical:true,quantity:0},geometry));
  assert.throws(()=>makeKit(model,data,{...opts,physical:true,zipCode:"bad"},geometry));
});
test("the proof is rendered from the selected mesh and finish",()=>{
  const data=calendar({year:2025,days:{"2025-08-01":10}});
  const model=geometry.createModel({...data,label:"ACME"});
  const green=proofPixels(model,"Evergreen",350,150);
  const blue=proofPixels(model,"Glacier",350,150);
  assert.equal(green.length,350*150*4);
  let different=0,ink=0;
  for(let i=0;i<green.length;i+=4){if(green[i+1]!==blue[i+1])different++;if(green[i]<75)ink++;}
  assert(different>5);assert(ink>300);
});
