"use strict";

const SkylineKit = (() => {
  const encoder = new TextEncoder();
  const crcTable = Uint32Array.from({length:256}, (_, value) => {
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
    return value >>> 0;
  });
  function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
    return (crc ^ 0xffffffff) >>> 0;
  }
  function zip(files) {
    const entries = Object.entries(files).map(([name, value]) => {
      const data = typeof value === "string" ? encoder.encode(value) : value;
      return {name:encoder.encode(name), data, crc:crc32(data)};
    });
    const localLength = entries.reduce((sum,f)=>sum+30+f.name.length+f.data.length,0);
    const directoryLength = entries.reduce((sum,f)=>sum+46+f.name.length,0);
    const bytes = new Uint8Array(localLength + directoryLength + 22);
    const view = new DataView(bytes.buffer);
    const short = (p,n)=>view.setUint16(p,n,true), long = (p,n)=>view.setUint32(p,n,true);
    let p=0, central=localLength;
    for (const entry of entries) {
      const {name,data,crc} = entry;
      long(p,0x04034b50); short(p+4,20); short(p+12,33); long(p+14,crc);
      long(p+18,data.length); long(p+22,data.length); short(p+26,name.length);
      bytes.set(name,p+30); bytes.set(data,p+30+name.length);
      long(central,0x02014b50); short(central+4,20); short(central+6,20); short(central+14,33);
      long(central+16,crc); long(central+20,data.length); long(central+24,data.length);
      short(central+28,name.length); long(central+42,p); bytes.set(name,central+46);
      p+=30+name.length+data.length;
      central+=46+name.length;
    }
    long(central,0x06054b50); short(central+8,entries.length); short(central+10,entries.length);
    long(central+12,directoryLength); long(central+16,localLength);
    return bytes;
  }

  function printPlate(model, geometry) {
    const {capOffset} = geometry.layout(model, "plate");
    const cap = model.cap.map(facet => facet.map(point => point.map((n, axis) => n + capOffset[axis])));
    return geometry.toSTL(model.body.concat(cap));
  }

  function colorPlate(model, geometry, finish) {
    const palette = {Evergreen:"#255D56", Glacier:"#387899", Marigold:"#B06B2E"};
    if (!Object.hasOwn(palette, finish)) throw new Error("Choose a supported skyline finish.");
    function object(id, name, facets, skyline) {
      const indices = new Map(), vertices = [];
      function index(point) {
        const key = point.join(",");
        if (!indices.has(key)) {
          indices.set(key, vertices.length);
          vertices.push(`<vertex x="${point[0]}" y="${point[1]}" z="${point[2]}"/>`);
        }
        return indices.get(key);
      }
      const faces = facets.map(face => {
        const [a,b,c] = face.map(index);
        const colored = skyline && face.some(point => point[2] > model.baseHeight);
        return `<triangle v1="${a}" v2="${b}" v3="${c}"${colored ? ' pid="1" p1="1"' : ''}/>`;
      });
      return `<object id="${id}" type="model" name="${name}" pid="1" pindex="0"><mesh><vertices>${vertices.join("")}</vertices><triangles>${faces.join("")}</triangles></mesh></object>`;
    }
    const offset = geometry.layout(model,"plate").capOffset.join(" ");
    const materials = `<basematerials id="1"><base name="Charcoal PLA" displaycolor="#303332"/><base name="${finish} PLA" displaycolor="${palette[finish]}"/></basematerials>`;
    const objects = object(2,"Skyline",model.body,true) + object(3,"End cap",model.cap,false);
    return zip({
      "[Content_Types].xml": '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>',
      "_rels/.rels": '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="model" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" Target="/3D/3dmodel.model"/></Relationships>',
      "3D/3dmodel.model": `<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources>${materials}${objects}</resources><build><item objectid="2"/><item objectid="3" transform="1 0 0 0 1 0 0 0 1 ${offset}"/></build></model>`
    });
  }

  const plain = text => String(text).replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, " ");
  function makeKit(model, data, options, geometry) {
    const estimatedWidth = model.joinX + model.capWidth;
    const natural = n => Number(n.toFixed(2));
    const printInfo = [
      "GH ACTIVITY SKYLINE", "Print instructions", "",
      "Inscription: " + model.engravedText,
      ...(options.physical ? ["Calendar: " + data.year] : [
        "Source: " + (options.isSample ? "fictional studio sample" : plain(data.source || "locally imported daily counts")),
        ...(data.contributor ? ["Contributor: @" + plain(data.contributor)] : []),
        "Calendar: " + data.year + " | Total: " + data.total + " | Active days: " + data.active
      ]),
      model.style === "contour" ? "Sculpture form: contour relief. Each ridge traces one weekday, with the activity height sampled at the center of each week." :
        "Sculpture form: architecture. Each active date makes one tower.",
      "Week columns run left to right, with Sunday at the back and Saturday at the front lip. Height uses a relative scale for this year.", "",
      "The two binary STL files use millimeters. Import each at 100% scale with its broad flat side on the bed.",
      "Body including its joining key: " + [model.width,model.depth,model.height].map(natural).join(" x ") + " mm.",
      "Body with the end cap fitted: " + natural(estimatedWidth) + " mm wide.",
      "Material requested: matte PLA. Base and end cap: charcoal. " + (model.style === "contour" ? "Ridges: " : "Towers: ") + options.finish + ".",
      "Suggested starting profile: 0.4 mm nozzle, 0.2 mm layers. Confirm the layer change and tower details in the slicer.",
      "For a two-color body, print charcoal through Z " + natural(model.baseHeight) + " mm and change filament before the first tower layer above it. The end cap stays charcoal.",
      "The cap slides onto the right-hand key from above. Remove it and fit the next yearly section in the same position.",
      "Keep scale consistent across years. Check the first physical fit and lettering before making multiples.", ""
    ];
    const files = {
      "skyline-color.3mf":colorPlate(model,geometry,options.finish),
      "skyline.stl":geometry.toSTL(model.body),
      "end-cap.stl":geometry.toSTL(model.cap),
      "print-guide.txt":printInfo.join("\r\n")
    };
    if (options.proof) files["model-proof.png"]=options.proof;
    if (options.physical) {
      const quantity = options.quantity;
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 250) throw new Error("Choose 1–250 identical pieces per request.");
      if (options.zipCode && !/^\d{5}$/.test(options.zipCode)) throw new Error("Use a five-digit U.S. ZIP code or leave it blank.");
      files["print-request.txt"] = [
        "GH ACTIVITY SKYLINE", "U.S. production quote request", "",
        "Please quote " + quantity + " complete desk piece" + (quantity === 1 ? "" : "s") + " from the two supplied STL files.",
        "Inscription: " + model.engravedText, (model.style === "contour" ? "Ridge finish: " : "Tower finish: ") + options.finish + " PLA over charcoal PLA. End cap: charcoal.",
        "Destination: " + (options.zipCode ? "U.S. ZIP " + options.zipCode : "U.S. ZIP to be confirmed."),
        "Quantity refers to duplicates of this inscription and geometry. Different calendars require their own file pair.",
        "Please confirm the final landed cost, print time, color-change charge, cap fit check, packaging, shipping, lead time and replacement policy.",
        "For seller fulfillment, please confirm blind packing and how separate personalized files and delivery addresses are handled.",
        "Ship only after a final quote and order are approved.", ""
      ].join("\r\n");
    }
    return zip(files);
  }
  return {zip,makeKit,printPlate,colorPlate,crc32};
})();
if (typeof module !== "undefined" && module.exports) module.exports = SkylineKit;
