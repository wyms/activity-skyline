const test = require("node:test");
const assert = require("node:assert/strict");
const {createModel, layout, printableLabel, labelLimit, toSTL} = require("../site/mesh.js");

const calendar = (size, count) => Array.from({length:size}, (_, week) =>
  Array.from({length:7}, (_, day) => typeof count === "function" ? count(week, day) : count));

function cross(a, b) {
  return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
}
function dot(a, b) { return a[0]*b[0] + a[1]*b[1] + a[2]*b[2]; }
function minus(a, b) { return a.map((value,i) => value-b[i]); }

// Inspect the single-precision coordinates actually written to the STL.
function inspectSTL(triangles) {
  const bytes = toSTL(triangles);
  const view = new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  assert.equal(view.getUint32(80,true),triangles.length);
  assert.equal(bytes.length,84+50*triangles.length);
  let offset = 84, volume = 0;
  const points = new Map(), edges = new Map(), incident = [];
  const min = [Infinity,Infinity,Infinity], max = [-Infinity,-Infinity,-Infinity];
  const adjacent = Array.from({length:triangles.length},()=>[]);
  function readVector() {
    const v = [view.getFloat32(offset,true),view.getFloat32(offset+4,true),view.getFloat32(offset+8,true)];
    offset += 12;
    return v;
  }
  for (let tri = 0; tri < triangles.length; tri++) {
    const normal = readVector(), a = readVector(), b = readVector(), c = readVector();
    assert.equal(view.getUint16(offset,true),0);
    offset += 2;
    const computed = cross(minus(b,a),minus(c,a));
    assert.ok(dot(computed,normal) > 0,"facet normal must agree with its winding");
    assert.ok(Math.abs(Math.hypot(...normal)-1)<1e-5);
    volume += dot(a,cross(b,c))/6;
    const ids = [a,b,c].map(p => {
      for (let axis=0; axis<3; axis++) {
        min[axis] = Math.min(min[axis],p[axis]);
        max[axis] = Math.max(max[axis],p[axis]);
      }
      const key = p.join(",");
      if (!points.has(key)) { points.set(key,points.size); incident.push([]); }
      const id = points.get(key);
      incident[id].push(tri);
      return id;
    });
    for (let i=0; i<3; i++) {
      const from = ids[i], to = ids[(i+1)%3];
      const key = from<to ? from+","+to : to+","+from;
      if (!edges.has(key)) edges.set(key,[]);
      edges.get(key).push({tri,from,to});
    }
  }
  for (const [key, pair] of edges) {
    assert.equal(pair.length,2,"edge "+key+" should belong to two facets");
    const [a,b] = pair;
    assert.ok(a.from===b.to && a.to===b.from,"neighboring facets must have opposing edge orientation");
    adjacent[a.tri].push(b.tri); adjacent[b.tri].push(a.tri);
  }
  function visit(start,accept) {
    const seen = new Set([start]), pending = [start];
    while (pending.length) {
      for (const next of adjacent[pending.pop()]) {
        if (accept(next) && !seen.has(next)) { seen.add(next); pending.push(next); }
      }
    }
    return seen.size;
  }
  assert.equal(visit(0,()=>true),triangles.length,"the shell must have one connected surface");
  for (const faces of incident) {
    const local = new Set(faces);
    assert.equal(visit(faces[0],i=>local.has(i)),faces.length,"all faces incident to a vertex form one fan");
  }
  assert.ok(volume>0,"the shell must point outwards");
  return {min,max,volume};
}

// Vertical projections of upward-facing triangles reveal the finished part
// footprint and the bottom of each engraving without looking inside the generator.
function topAt(triangles,x,y) {
  const xyCross = (a,b) => (b[0]-a[0])*(y-a[1]) - (b[1]-a[1])*(x-a[0]);
  let top = 0;
  for (const [a,b,c] of triangles) {
    if (a[2]!==b[2] || b[2]!==c[2] || a[2]===0) continue;
    if (xyCross(a,b)>=-1e-8 && xyCross(b,c)>=-1e-8 && xyCross(c,a)>=-1e-8) top=Math.max(top,a[2]);
  }
  return top;
}

// Intersect a vertical ray with the sloping triangles of the exported terrain.
function terrainAt(faces, x, y) {
  let top = -Infinity;
  for (const [a,b,c] of faces) {
    if (x < Math.min(a[0],b[0],c[0])-1e-7 || x > Math.max(a[0],b[0],c[0])+1e-7 ||
        y < Math.min(a[1],b[1],c[1])-1e-7 || y > Math.max(a[1],b[1],c[1])+1e-7) continue;
    const [nx,ny,nz] = cross(minus(b,a),minus(c,a));
    if (nz<=1e-8) continue;
    const side = (p,q) => (q[0]-p[0])*(y-p[1])-(q[1]-p[1])*(x-p[0]);
    if (side(a,b)<-1e-7 || side(b,c)<-1e-7 || side(c,a)<-1e-7) continue;
    top = Math.max(top,a[2]-(nx*(x-a[0])+ny*(y-a[1]))/nz);
  }
  return top;
}

test("STL shells are closed, consistently oriented and connected for empty, dense and irregular calendars", () => {
  const cases = [
    {weeks:calendar(52,0),label:""},
    {weeks:calendar(53,(week,day)=>(week+day)%11 ? (3*week+day)%46 : 0),label:"A&B / R&D @ HQ #2"},
    {weeks:calendar(54,1),label:"ABCDEFGHIJKLMNOPQRSTUVWX"}
  ];
  for (const item of cases) {
    const model = createModel({...item,year:2024});
    for (const [tris,width,depth,height] of [
      [model.body,model.width,model.depth,model.height],[model.cap,model.capWidth,model.depth,model.baseHeight]
    ]) {
      const {min,max} = inspectSTL(tris);
      assert.deepEqual(min,[0,0,0]);
      for (const [i,dimension] of [width,depth,height].entries()) assert.ok(Math.abs(dimension-max[i])<0.00001);
    }
  }
});

test("calendar columns and Sunday-to-Saturday rows give individual days distinct towers", () => {
  const weeks = calendar(53,0);
  weeks[0][0]=1; weeks[0][6]=2; weeks[52][6]=500;
  const model = createModel({weeks,label:"Test",year:2025});
  assert.equal(model.towers.length,3);
  const [sunday,saturday,last] = model.towers;
  assert.ok(sunday.y>saturday.y && sunday.x===saturday.x && saturday.x<last.x);
  assert.deepEqual(model.towers.map(t=>t.count),[1,2,500]);
  assert.ok(sunday.h===2 && sunday.h<saturday.h && saturday.h<last.h && last.h===20);
  for (const tower of model.towers) {
    const z=topAt(model.body,tower.x+tower.w/2,tower.y+tower.d/2);
    assert.ok(Math.abs(z-tower.h-model.baseHeight)<0.000001);
    assert.ok(tower.w>2 && tower.d>2 && Number.isInteger(Math.round(tower.h*100)/20));
  }
  assert.equal(topAt(model.body,sunday.x+sunday.w+0.15,sunday.y+sunday.d/2),model.baseHeight);
});

test("all four building forms have sloped roof facets and printable crown lands", () => {
  const weeks = calendar(54,0);
  weeks[0] = [1,4,12,50,100,0,0];
  weeks[8][1] = 4;
  const model = createModel({weeks,label:"Civic skyline",year:2028});
  const forms = new Set(model.towers.map(tower=>tower.form));
  assert.deepEqual(forms,new Set(["pavilion","folded","setback","lantern"]));
  for (const tower of model.towers) {
    const inLot = ([x,y]) => x>=tower.x-1e-7 && x<=tower.x+tower.w+1e-7 &&
      y>=tower.y-1e-7 && y<=tower.y+tower.d+1e-7;
    const faces = model.body.filter(t=>t.every(inLot) && t.some(p=>p[2]>model.baseHeight));
    const roofZ = model.baseHeight+tower.h;
    const roof = faces.filter(t=>t.every(p=>Math.abs(p[2]-roofZ)<1e-6));
    const topPoints = roof.flat();
    const width = Math.max(...topPoints.map(p=>p[0])) - Math.min(...topPoints.map(p=>p[0]));
    const depth = Math.max(...topPoints.map(p=>p[1])) - Math.min(...topPoints.map(p=>p[1]));
    assert.ok(width>=1.06-1e-7 && depth>=1.18-1e-7,"peak has a printable flat land");
    assert.ok(width*depth<tower.w*tower.d*0.70,"crown is narrower than its shaft");
    assert.equal(new Set(topPoints.map(p=>p.join(","))).size,8,"roof has eight corners");
    let slopedRoofs=0, intermediateTerraces=0;
    for (const [a,b,c] of faces) {
      const n = cross(minus(b,a),minus(c,a));
      assert.ok(n[2]>=-1e-7,"every elevated face is vertical or faces upward");
      const dz = Math.max(a[2],b[2],c[2])-Math.min(a[2],b[2],c[2]);
      if (n[2]>0.025 && dz>0.6) slopedRoofs++;
      if (n[2]>0.025 && dz===0 && a[2]<roofZ-0.1) intermediateTerraces++;
    }
    assert.ok(slopedRoofs>=4,"the crown includes prominent sloped facets in the actual mesh");
    assert.equal(intermediateTerraces>0,tower.form==="setback");
    if (tower.form==="folded") {
      const towerCenter = tower.x+tower.w/2;
      const roofCenter = (Math.min(...topPoints.map(p=>p[0]))+Math.max(...topPoints.map(p=>p[0])))/2;
      assert.ok(tower.week===0 ? roofCenter>towerCenter+0.35 : roofCenter<towerCenter-0.35,
        "folded roofs alternate slope direction by district");
    }
  }
});

test("print-bed and assembled previews locate the same exported parts", () => {
  const model = createModel({weeks:calendar(54,12),label:"Test",year:2028});
  assert.deepEqual(layout(model), {capOffset:[171,0,0],width:179,depth:37,height:26.4});
  assert.deepEqual(layout(model,"plate"), {capOffset:[0,41,0],width:175.5,depth:78,height:26.4});
  assert.throws(()=>layout(model,"other"),/layout/);
});

test("contour exports one watertight supported shell on empty, isolated and full calendars", () => {
  const isolated = calendar(53,0); isolated[0][0]=30; isolated[52][6]=1;
  for (const weeks of [calendar(52,0),isolated,calendar(54,(w,d)=>(w*23+d*7)%37+1)]) {
    const model = createModel({weeks,style:"contour",year:2028,label:"Anniversary"});
    const {min,max,volume} = inspectSTL(model.body);
    assert.deepEqual(min,[0,0,0]);
    assert.equal(max[0],model.width); assert.equal(max[1],model.depth);
    assert.ok(Math.abs(max[2]-model.height)<1e-5 && volume>0);
    for (const [a,b,c] of model.body) {
      if (Math.max(a[2],b[2],c[2])>model.baseHeight+1e-6) {
        assert.ok((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])>0,
          "the complete ridge sits on a supported height field");
      }
    }
  }
});

test("ridge heights preserve each selected date and drop to the base on inactive weekdays and weeks", () => {
  const weeks = calendar(53,0);
  weeks[0][0]=2; weeks[5][6]=12; weeks[6][6]=3; weeks[7][0]=2; weeks[8][6]=6;
  weeks[9][0]=90; weeks[9][1]=8; weeks[9][4]=4; weeks[9][6]=6; weeks[52][5]=10;
  const config = {weeks,year:2026,label:"Harbour"};
  const towers = createModel({...config,style:"towers"});
  const model = createModel({...config,style:"contour"});
  assert.equal(createModel(config).style,"towers");
  assert.equal(model.style,"contour");
  assert.deepEqual(model.cap,towers.cap);
  assert.deepEqual(layout(model),layout(towers));
  const dateData=({form,...rest})=>rest;
  assert.deepEqual(model.towers.map(dateData),towers.towers.map(dateData));
  assert.ok(model.towers.every(t=>t.form==="ridge"));
  const centerX=t=>t.x+t.w/2, centerY=t=>t.y+t.d/2;
  const sample=(x,y)=>terrainAt(model.body,x,y)-model.baseHeight;
  for (const date of model.towers) {
    assert.ok(Math.abs(sample(centerX(date),centerY(date))-date.h)<1e-7);
  }
  const saturated = model.towers.find(t=>t.week===9 && t.day===0);
  const tuesdayY = centerY(saturated) - 2*3.38;
  const fridayY = centerY(saturated) - 5*3.38;
  assert.ok(Math.abs(sample(centerX(saturated),tuesdayY))<1e-7);
  assert.ok(Math.abs(sample(centerX(saturated),fridayY))<1e-7);
  // Saturday has a quiet week between two active weeks.
  const sat = model.towers.find(t=>t.week===6&&t.day===6);
  const quietX = centerX(model.towers.find(t=>t.week===7));
  for (const offset of [-0.40,0,0.40]) assert.ok(Math.abs(sample(quietX+offset,centerY(sat)))<1e-7);
  const firstX = centerX(sat), positions = [0,0.25,0.5,0.75,1];
  const descent = positions.map(t=>sample(firstX+(quietX-firstX)*t,centerY(sat)));
  assert.ok(descent.every((z,i)=>i===0 || z<descent[i-1]-0.01),"a rising or falling date produces a continuous slope");
  // The summit's flat land can take at least two 0.4 mm extrusion lines.
  const x = centerX(saturated), nominalY = centerY(saturated);
  const peaks = model.body.flat().filter(p=>Math.abs(p[0]-x)<1e-7 && Math.abs(p[1]-nominalY)<1.1 &&
    Math.abs(p[2]-model.height)<1e-7);
  const ridgeY = (Math.min(...peaks.map(p=>p[1]))+Math.max(...peaks.map(p=>p[1])))/2;
  for (const dx of [-0.4,0.4]) for (const dy of [-0.4,0.4]) {
    assert.ok(Math.abs(sample(x+dx,ridgeY+dy)-saturated.h)<1e-7);
  }
  const crest = sample(x,ridgeY), shoulder = sample(x,ridgeY+0.93), foot = sample(x,ridgeY+1.4);
  assert.ok(crest>shoulder && shoulder>foot+1,"the ridge rolls into its adjacent valley");
});

test("both receiving sockets fit the same T-key with clearance and the cap ends at 179 mm", () => {
  const m = createModel({weeks:calendar(53,0),label:"",year:2025});
  assert.equal(m.width,175.5); assert.equal(m.assembledWidth,179); assert.equal(m.joinX+m.capWidth,m.assembledWidth);
  const mid=m.depth/2;
  for(const [x,y] of [[1,mid],[1,mid+3.35],[3,mid+5.16],[4.48,mid],[3,mid-5.16]]) {
    assert.equal(topAt(m.body,m.joinX+x,y),m.baseHeight,"male feature is present");
    assert.equal(topAt(m.cap,x,y),0,"cap clears key");
    assert.equal(topAt(m.body,x,y),0,"next year's socket clears key");
  }
  assert.equal(topAt(m.body,m.joinX+1,mid+4.0),0,"neck is narrower than T head");
  assert.equal(topAt(m.cap,1,mid+3.6),0,"neck clearance");
  assert.equal(topAt(m.cap,1,mid+3.8),m.baseHeight,"retaining shoulder");
  assert.equal(topAt(m.cap,3,mid+5.5),0,"head clearance");
  assert.equal(topAt(m.cap,3,mid+5.6),m.baseHeight);
  assert.equal(topAt(m.cap,4.8,mid),0,"depth clearance");
  assert.equal(topAt(m.cap,4.9,mid),m.baseHeight);
});

test("both the user's lettering and year are recessed into the print", () => {
  const make=(label,year)=>createModel({weeks:calendar(53,0),label,year});
  const a=make("sample",2025), b=make("sample",2026), c=make("simple",2025);
  assert.equal(a.engravedText,"SAMPLE / 2025");
  const pits=model=>model.body.filter(t=>t.every(p=>p[2]===5.6));
  assert.ok(pits(a).length>0);
  assert.notDeepEqual(pits(a),pits(b));
  assert.notDeepEqual(pits(a),pits(c));
  assert.equal(a.height,a.baseHeight,"an empty graph still has a printable engraved base");
  assert.equal(printableLabel("  Zoë / A✔B  "),"ZOE / A B");
  assert.equal(printableLabel("A".repeat(45)).length,labelLimit);
  assert.equal(make("★",2026).engravedText,"2026");
});

test("the full alphabet, digits and punctuation carve connected continuous strokes", () => {
  for (const label of ["ABCDEFGHIJKLMNOPQRSTUVWX", "YZ0123456789-_. /@&+#'"]) {
    const model = createModel({weeks:calendar(53,0),label,year:2026});
    inspectSTL(model.body);
    const text = model.engravedText;
    const origin = Math.round((17100-(text.length*6-1)*86)/2)/100;
    const faces = Array.from(text,()=>[]);
    for (const t of model.body) {
      if (t.every(p=>p[2]===5.6)) {
        const centerX = (t[0][0]+t[1][0]+t[2][0])/3;
        faces[Math.floor((centerX-origin)/5.16)].push(t);
      }
    }
    for (let i=0; i<text.length; i++) {
      const glyph = faces[i];
      if (text[i]===" ") { assert.equal(glyph.length,0); continue; }
      assert.ok(glyph.length>0,text[i]);
      const labels = glyph.map((_,j)=>j), edgeOwner = new Map();
      function representative(j) {
        while (labels[j]!==j) { labels[j]=labels[labels[j]]; j=labels[j]; }
        return j;
      }
      glyph.forEach((face,number)=>{
        const keys = face.map(p=>p.join(","));
        keys.forEach((a,j)=>{
          const b = keys[(j+1)%3], key = a<b ? a+"|"+b : b+"|"+a;
          if (edgeOwner.has(key)) labels[representative(number)]=representative(edgeOwner.get(key));
          else edgeOwner.set(key,number);
        });
      });
      assert.equal(new Set(labels.map((_,j)=>representative(j))).size,1,
        text[i]+" should engrave as one connected channel, including its diagonal joints");
    }
  }
  const sample = createModel({weeks:calendar(52,0),label:"I/",year:2026});
  const start = Math.round((17100-(sample.engravedText.length*6-1)*86)/2)/100;
  for (let gap=0; gap<6; gap++) {
    for (const dx of [-0.35,0.35]) {
      assert.equal(topAt(sample.body,start+2.5*0.86+dx,1+gap*1.24+1.0),5.6,
        "I retains a continuous full-width stem between rows");
    }
  }
});

test("malformed data is reported before constructing a mesh", () => {
  assert.throws(()=>createModel({weeks:calendar(53,1),year:2024,style:"unknown"}),/style/);
  assert.throws(()=>createModel({weeks:calendar(51,0),year:2024}),/weeks/);
  assert.throws(()=>createModel({weeks:calendar(54,0),year:NaN}),/year/);
  for (const value of [null,-1,0.5,Infinity]) {
    const weeks=calendar(53,0); weeks[0][2]=value;
    assert.throws(()=>createModel({weeks,year:2024}),/counts/);
  }
  const incomplete=calendar(53,0); delete incomplete[0][2];
  assert.throws(()=>createModel({weeks:incomplete,year:2024}),/counts/);
});
