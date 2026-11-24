const test = require("node:test");
const assert = require("node:assert/strict");
const {createHash} = require("node:crypto");
const {calendar} = require("../site/calendar.js");
const {createModel} = require("../site/mesh.js");
const {Viewer, proofPixels, proofSize, zoomLimits} = require("../site/viewer.js");

const data = calendar({year:2025, days:{
  "2025-03-01":3,"2025-03-08":9,"2025-03-15":5,"2025-04-01":14,"2025-12-20":2
}});
const model = createModel({...data, label:"ART", style:"contour"});
const hash = pixels => createHash("sha256").update(pixels).digest();

class TestCanvas extends EventTarget {
  constructor() {
    super();
    this.attributes = {};
  }
  getBoundingClientRect() { return {width:360,height:164}; }
  setAttribute(key,value) { this.attributes[key] = value; }
  getContext() {
    return {
      createImageData:(width,height) => ({data:new Uint8ClampedArray(width*height*4)}),
      putImageData:frame => { this.image = frame.data; }
    };
  }
  toBlob(callback,type) {
    // Transport the frame digest so the test can compare exactly what the
    // browser sends to its PNG encoder, without depending on a native canvas.
    assert.equal(type,"image/png");
    callback(new Blob([hash(this.image)],{type}));
  }
  input(name,fields) {
    const event = Object.assign(new Event(name,{cancelable:true}),fields);
    this.dispatchEvent(event);
    return event;
  }
}

test("the camera, plate inspection and PNG downloads use the selected scene", async t => {
  const pending = new Map();
  let ticket = 0;
  const install = (key,value) => {
    const old = Object.getOwnPropertyDescriptor(globalThis,key);
    Object.defineProperty(globalThis,key,{configurable:true,value});
    t.after(() => old ? Object.defineProperty(globalThis,key,old) : delete globalThis[key]);
  };
  install("requestAnimationFrame", fn => { pending.set(++ticket,fn); return ticket; });
  install("window",{devicePixelRatio:1, addEventListener(){}});
  install("document",{createElement:() => new TestCanvas()});
  function draw() {
    for (const [id,fn] of pending) { pending.delete(id); fn(); }
  }
  const canvas = new TestCanvas(), fallback = {}, viewer = new Viewer(canvas,fallback);
  const changes = [], completions = [];
  canvas.addEventListener("viewchange", e => changes.push(e.detail));
  canvas.addEventListener("modeldrawn", () => completions.push(hash(canvas.image)));
  assert.equal(fallback.hidden,true);
  assert.equal(await viewer.proofPNG(),null);

  viewer.setModel(model); draw();
  assert.equal(canvas.attributes["data-rendered"],"true");
  assert.equal(completions.length,1);
  const assembled = hash(canvas.image);
  viewer.setLayout("plate"); draw();
  assert.notDeepEqual(hash(canvas.image),assembled);
  assert.deepEqual(changes.at(-1),{view:"iso",zoom:1,layout:"plate"});
  assert.equal(canvas.input("keydown",{key:"3"}).defaultPrevented,true);
  viewer.zoomBy(100); draw();
  assert.deepEqual(changes.at(-1),{view:"top",zoom:zoomLimits.max,layout:"plate"});
  const magnified=hash(canvas.image);
  canvas.input("keydown",{key:"ArrowRight",shiftKey:true}); draw();
  assert.notDeepEqual(hash(canvas.image),magnified);
  viewer.setView("top"); draw();
  assert.deepEqual(hash(canvas.image),magnified);
  viewer.zoomBy(.0001);
  assert.equal(changes.at(-1).zoom,zoomLimits.min);
  canvas.input("pointerdown",{pointerType:"touch",pointerId:1,clientX:10,clientY:10});
  canvas.input("pointerdown",{pointerType:"touch",pointerId:2,clientX:40,clientY:10});
  canvas.input("pointermove",{pointerId:2,clientX:70,clientY:10});
  assert.equal(changes.at(-1).zoom,zoomLimits.min*2);
  canvas.input("pointerup",{pointerId:2});
  canvas.input("pointermove",{pointerId:1,clientX:30,clientY:13});
  canvas.input("pointerup",{pointerId:1}); draw();
  assert.equal(changes.at(-1).view,"custom");
  assert.equal(completions.length,1);

  const inspection = Buffer.from(await viewer.proofPNG({currentView:true}));
  const canonical = Buffer.from(await viewer.proofPNG());
  assert.notDeepEqual(inspection,canonical);
  assert.deepEqual(canonical,hash(proofPixels(model,"Evergreen",proofSize.width,proofSize.height)));
  viewer.reset(); viewer.setLayout("assembled"); draw();
  assert.deepEqual(hash(canvas.image),assembled);
  assert.deepEqual(Buffer.from(await viewer.proofPNG({currentView:true})),canonical);
  viewer.setModel(model); draw();
  assert.equal(completions.length,2);
});

test("contour smoothing preserves the silhouette and the graphite engraving", () => {
  const smooth = proofPixels(model,"Evergreen",700,320);
  const faceted = proofPixels({...model,style:"towers"},"Evergreen",700,320);
  let changed = 0;
  for (let i=0;i<smooth.length;i+=4) {
    if (smooth[i]===faceted[i] && smooth[i+1]===faceted[i+1] && smooth[i+2]===faceted[i+2]) continue;
    // Only samples with green terrain coverage may change, including its
    // antialiased edge. Empty floor, cuts and base-only pixels agree exactly.
    assert(smooth[i+1]>smooth[i]+2 || faceted[i+1]>faceted[i]+2);
    changed++;
  }
  assert(changed>100);
});
