/* The plinth is constructed in hundredths of a millimeter. Adjacent contour
 * strips share their interpolated vertices. Output coordinates are millimeters. */
(function (root) {
  "use strict";

  const BODY_LENGTH = 17100;
  const DEPTH = 3700;
  const BASE = 640;
  const FOOT = BASE + 20;
  // A construction tag for the rectangular patch occupied by the contour skin.
  // Its actual rim sits at BASE and joins the top of the plinth.
  const CONTOUR_PATCH = BASE + 1;
  const CREST_HALF_X = 42;
  const CREST_HALF_Y = 49;
  const CAP_LENGTH = 800;
  const NECK = 240;
  const KEY = 450;
  const CLEARANCE = 35;
  const MID_Y = DEPTH / 2;
  const HALF_NECK = 340;
  const HALF_HEAD = 520;
  const LABEL_LIMIT = 24;
  const millimeters = value => value / 100;

  // Five columns per glyph, read from the most significant bit.
  const font = {
    A:[14,17,17,31,17,17,17], B:[30,17,17,30,17,17,30],
    C:[14,17,16,16,16,17,14], D:[28,18,17,17,17,18,28],
    E:[31,16,16,30,16,16,31], F:[31,16,16,30,16,16,16],
    G:[14,17,16,23,17,17,15], H:[17,17,17,31,17,17,17],
    I:[14,4,4,4,4,4,14], J:[7,2,2,2,2,18,12],
    K:[17,18,20,24,20,18,17], L:[16,16,16,16,16,16,31],
    M:[17,27,21,21,17,17,17], N:[17,25,25,21,19,19,17],
    O:[14,17,17,17,17,17,14], P:[30,17,17,30,16,16,16],
    Q:[14,17,17,17,21,18,13], R:[30,17,17,30,20,18,17],
    S:[15,16,16,14,1,1,30], T:[31,4,4,4,4,4,4],
    U:[17,17,17,17,17,17,14], V:[17,17,17,17,17,10,4],
    W:[17,17,17,21,21,21,10], X:[17,17,10,4,10,17,17],
    Y:[17,17,10,4,4,4,4], Z:[31,1,2,4,8,16,31],
    0:[14,17,19,21,25,17,14], 1:[4,12,4,4,4,4,14],
    2:[14,17,1,2,4,8,31], 3:[30,1,1,14,1,1,30],
    4:[2,6,10,18,31,2,2], 5:[31,16,16,30,1,1,30],
    6:[14,16,16,30,17,17,14], 7:[31,1,2,4,8,8,8],
    8:[14,17,17,14,17,17,14], 9:[14,17,17,15,1,1,14],
    "-":[0,0,0,31,0,0,0], "_":[0,0,0,0,0,0,31], ".":[0,0,0,0,0,0,4],
    "/":[1,1,2,4,8,16,16], "@":[14,17,23,21,23,16,14],
    "&":[12,18,20,8,21,18,13], "+":[0,4,4,31,4,4,0],
    "#":[10,10,31,10,31,10,10], "'":[4,4,8,0,0,0,0], " ":[0,0,0,0,0,0,0]
  };

  function printableLabel(value) {
    const characters = String(value ?? "").normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "").toUpperCase();
    const printable = Array.from(characters, char => Object.hasOwn(font, char) ? char : " ").join("");
    return printable.trim().replace(/\s+/g, " ").slice(0, LABEL_LIMIT).trimEnd();
  }

  function rect(left, front, right, back, top) {
    return {left, front, right, back, top};
  }

  // The socket is open at both the top and bottom. The receiver drops onto
  // the T-key and is held against horizontal pull without a roof or supports.
  function plinth(length, hasKey) {
    const layers = [
      rect(0, 0, length, DEPTH, BASE),
      rect(0, MID_Y - HALF_NECK - CLEARANCE, NECK - CLEARANCE, MID_Y + HALF_NECK + CLEARANCE, 0),
      rect(NECK - CLEARANCE, MID_Y - HALF_HEAD - CLEARANCE, KEY + CLEARANCE, MID_Y + HALF_HEAD + CLEARANCE, 0)
    ];
    if (hasKey) {
      layers.push(rect(length, MID_Y - HALF_NECK, length + NECK, MID_Y + HALF_NECK, BASE));
      layers.push(rect(length + NECK, MID_Y - HALF_HEAD, length + KEY, MID_Y + HALF_HEAD, BASE));
    }
    return layers;
  }

  function engrave(layers, inscription) {
    const pitchX = 86, pitchY = 124, cutHeight = 78, cutDepth = 80;
    const totalWidth = (inscription.length * 6 - 1) * pitchX;
    const startX = Math.round((BODY_LENGTH - totalWidth) / 2);
    for (let letter = 0; letter < inscription.length; letter++) {
      const glyph = font[inscription[letter]];
      const origin = startX + letter*6*pitchX;
      for (let line = 0; line < glyph.length; line++) {
        const y = 100 + (6 - line) * pitchY;
        let col = 0;
        while (col < 5) {
          if (!(glyph[line] & (16 >> col))) { col++; continue; }
          const first = col;
          while (col < 5 && (glyph[line] & (16 >> col))) col++;
          const x = origin + first*pitchX;
          layers.push(rect(x, y, x + (col - first) * pitchX, y + cutHeight, BASE - cutDepth));
        }
        if (line === 0) continue;
        // Join the lower row to the one above. Shared columns make continuous
        // stems; true diagonal neighbors get three overlapping stroke segments.
        // The diagonal joins overlap by at least 0.71 mm at each end.
        const lower = glyph[line], upper = glyph[line-1];
        const lit = (mask,index) => index>=0 && index<5 && (mask & (16>>index))!==0;
        const spans = [[],[],[]];
        for (let column=0; column<5; column++) {
          if (!lit(lower,column)) continue;
          const x = origin+column*pitchX;
          if (lit(upper,column)) {
            for (const band of spans) band.push([x,x+pitchX]);
            continue;
          }
          for (const direction of [-1,1]) {
            const target = column+direction;
            if (lit(lower,target) || !lit(upper,target)) continue;
            [21,43,65].forEach((shift,part) => {
              const center=x+43+direction*shift;
              spans[part].push([center-49,center+49]);
            });
          }
        }
        const transitions = [0,15,31,pitchY-cutHeight];
        spans.forEach((ranges,part) => {
          ranges.sort((a,b)=>a[0]-b[0]);
          const merged = [];
          for (const range of ranges) {
            const previous = merged[merged.length-1];
            if (previous && range[0]-previous[1]<70) previous[1]=Math.max(previous[1],range[1]);
            else merged.push(range);
          }
          for (const [left,right] of merged) {
            layers.push(rect(left,y+cutHeight+transitions[part],right,y+cutHeight+transitions[part+1],BASE-cutDepth));
          }
        });
      }
    }
  }

  const sortedUnique = values => [...new Set(values)].sort((a, b) => a - b);
  const point = (x, y, z) => [millimeters(x), millimeters(y), millimeters(z)];

  // Overlay all rectangular footprints that cover this horizontal band.
  // Merge adjacent cells of equal height before triangulating their surfaces.
  function makeBand(left, right, rectangles) {
    const cuts = sortedUnique([left, right, ...rectangles.flatMap(r => [r.left, r.right])]);
    const at = new Map(cuts.map((x, i) => [x, i]));
    const values = new Array(cuts.length - 1).fill(0);
    for (const r of rectangles) values.fill(r.top, at.get(r.left), at.get(r.right));
    const xs = [left], heights = [values[0]];
    for (let i = 1; i < values.length; i++) {
      if (values[i] !== values[i - 1]) {
        xs.push(cuts[i]); heights.push(values[i]);
      }
    }
    xs.push(right);
    return {xs, heights};
  }

  function heightAt(band, x) {
    const {xs, heights} = band;
    if (x < xs[0] || x >= xs[xs.length - 1]) return 0;
    let left = 0, right = xs.length - 1;
    while (right - left > 1) {
      const middle = (left + right) >> 1;
      if (xs[middle] <= x) left = middle;
      else right = middle;
    }
    return heights[left];
  }

  // Fill the area between two parallel, independently subdivided lines.
  // Every edge on the perimeter appears exactly as it does on its neighbor.
  function stitch(out, a, b, aPoint, bPoint, reverse) {
    let i = 0, j = 0, p = aPoint(a[0]), q = bPoint(b[0]);
    function face(v0, v1, v2) {
      out.push(reverse ? [v0, v2, v1] : [v0, v1, v2]);
    }
    while (i + 1 < a.length || j + 1 < b.length) {
      if (j + 1 === b.length || (i + 1 < a.length && a[i + 1] <= b[j + 1])) {
        const next = aPoint(a[++i]);
        face(p, next, q);
        p = next;
      } else {
        const next = bPoint(b[++j]);
        face(p, next, q);
        q = next;
      }
    }
  }

  // Each pad leaves a rectangular opening in the top skin. Its four sides can
  // have extra vertices where the engraved base or a connector added a band.
  // Sew every one into the first octagonal section of the building.
  function addBuilding(faces, building, xsAt, yCuts) {
    const {left, right, front, back, rise, form} = building;
    const sideCuts = (cuts, lo, hi) => cuts.filter(value => lo <= value && value <= hi);
    const ys = sideCuts(yCuts, front, back);
    const boundary = [
      sideCuts(xsAt(front), left, right).map(x => point(x, front, FOOT)),
      ys.map(y => point(right, y, FOOT)),
      sideCuts(xsAt(back), left, right).reverse().map(x => point(x, back, FOOT)),
      [...ys].reverse().map(y => point(left, y, FOOT))
    ];
    // Coordinates in each octagon run counterclockwise, two per compass side.
    // Every upper section sits within the previous outline for support-free
    // printing. Roof heights and terraces sit on whole 0.2 mm layers.
    function ring(height, west, east, south, north, cutFraction) {
      const x0 = left + west, x1 = right - east, y0 = front + south, y1 = back - north;
      const cut = Math.round(Math.min(x1-x0, y1-y0) * cutFraction);
      const z = BASE + height;
      return [
        point(x0+cut,y0,z), point(x1-cut,y0,z), point(x1,y0+cut,z), point(x1,y1-cut,z),
        point(x1-cut,y1,z), point(x0+cut,y1,z), point(x0,y1-cut,z), point(x0,y0+cut,z)
      ];
    }
    let outline = ring(60, 6, 6, 6, 6, 0.22);
    for (let side = 0; side < 4; side++) {
      const floor = boundary[side], first = outline[2*side], last = outline[2*side+1];
      for (let i = 0; i+1 < floor.length; i++) faces.push([floor[i], floor[i+1], first]);
      const corner = floor[floor.length-1];
      faces.push([corner, last, first], [corner, outline[(2*side+2)%8], last]);
    }
    function loft(next) {
      for (let i = 0; i < 8; i++) {
        const j = (i+1)%8;
        faces.push([outline[i],outline[j],next[j]], [outline[i],next[j],next[i]]);
      }
      outline = next;
    }
    const layer = fraction => 20 * Math.round(rise * fraction / 20);
    if (form === "pavilion") {
      // A low hipped roof ends in a substantial ridge running front to back.
      loft(ring(layer(0.48), 6, 6, 6, 6, 0.22));
      loft(ring(rise, 56, 56, 35, 35, 0.23));
    } else if (form === "folded") {
      // A long sloping roof with an offset ridge into the street. Neighboring
      // eight-week groups share the same roof direction.
      loft(ring(layer(0.55), 10, 10, 10, 10, 0.21));
      const deepCut = Math.floor((right-left)*0.45);
      const facesEast = Math.floor(building.week/8)%2 === 0;
      loft(ring(rise, facesEast ? deepCut : 18, facesEast ? 18 : deepCut, 45, 30, 0.2));
    } else if (form === "setback") {
      // A 0.42 mm terrace catches light between the lower shaft and penthouse.
      const terrace = layer(0.55);
      loft(ring(terrace, 8, 8, 8, 8, 0.22));
      loft(ring(terrace, 50, 50, 50, 50, 0.22));
      loft(ring(layer(0.79), 50, 50, 50, 50, 0.22));
      loft(ring(rise, 62, 62, 72, 72, 0.24));
    } else {
      // A faceted shaft rises into long pitched shoulders and a blunt lantern.
      loft(ring(layer(0.47), 12, 12, 12, 12, 0.25));
      loft(ring(layer(0.73), 45, 45, 55, 55, 0.27));
      loft(ring(layer(0.86), 45, 45, 55, 55, 0.27));
      loft(ring(rise, 63, 63, 80, 80, 0.27));
    }
    for (let i = 1; i+1 < outline.length; i++) faces.push([outline[0],outline[i],outline[i+1]]);
  }

  // Monotone cubic interpolation gives neighboring contributions a common
  // tangent. Turning points have a short, printable level crest or trough.
  // The weighted harmonic slope handles the shorter end intervals.
  function ridgeCurve(xs, heights) {
    const slopes = [0], hold = [false];
    for (let i = 1; i+1 < xs.length; i++) {
      const previous = xs[i] - xs[i-1], next = xs[i+1] - xs[i];
      const a = (heights[i]-heights[i-1])/previous, b = (heights[i+1]-heights[i])/next;
      const w1 = 2*next + previous, w2 = next + 2*previous;
      slopes.push(a*b > 0 ? (w1+w2)/(w1/a+w2/b) : 0);
      hold.push(a*b < 0);
    }
    slopes.push(0); hold.push(false);
    return (i, x) => {
      const low = heights[i], high = heights[i+1];
      if (low === high) return low;
      const from = xs[i] + (hold[i] ? CREST_HALF_X : 0);
      const to = xs[i+1] - (hold[i+1] ? CREST_HALF_X : 0);
      if (x <= from) return low;
      if (x >= to) return high;
      const span = to-from, t = (x-from)/span, t2 = t*t, t3 = t*t2;
      const z = (2*t3-3*t2+1)*low + (t3-2*t2+t)*span*slopes[i] +
        (3*t2-2*t3)*high + (t3-t2)*span*slopes[i+1];
      return Math.max(Math.min(low,high), Math.min(Math.max(low,high), z));
    };
  }

  // Each cross-section is a function of x and y alone. Its upward winding
  // therefore produces a supported surface, including where a lane fades to zero.
  function addContours(faces, field, xsAt, yCuts) {
    const {left,right,front,back} = field;
    const rows = field.heights;
    const pitch = (back-front)/7;
    const xs = [left+30, ...field.centers, right-30];
    const sectionFront = front+24, sectionBack = back-24;
    const data = rows.map(row => [0,...row,0]);
    const curves = data.map(row => ridgeCurve(xs,row));
    const active = rows.map(row => row.some(v => v>0));
    const sections = [], coordinates = [];
    const shoulder = [0, 0.18, 0.38, 0.60, 0.82, 1];
    const ease = t => t*t*(3-2*t);
    function section(x, interval) {
      const progress = (x-left)/(right-left);
      // Neighboring lanes share a restrained meander. Its greatest displacement
      // is smaller than half the crest width, so the nominal date center still
      // samples its exact contribution height.
      const centers = rows.map((_, r) => front + (r+0.5)*pitch +
        24*Math.sin(2*Math.PI*3.3*progress+r*0.20) +
        10*Math.sin(2*Math.PI*7.4*progress+r*0.12));
      const points = [point(x,sectionFront,BASE)];
      for (let r = 0; r < 7; r++) {
        const low = r===0 ? sectionFront : (centers[r-1]+centers[r])/2;
        const high = r===6 ? sectionBack : (centers[r]+centers[r+1])/2;
        if (active[r]) {
          const elevation = curves[r](interval,x);
          const crestLeft = centers[r]-CREST_HALF_Y, crestRight = centers[r]+CREST_HALF_Y;
          const footLeft = low+21, footRight = high-21;
          for (const t of shoulder) {
            points.push(point(x,footLeft+(crestLeft-footLeft)*t,BASE+elevation*ease(t)));
          }
          for (const t of shoulder) {
            points.push(point(x,crestRight+(footRight-crestRight)*t,BASE+elevation*ease(1-t)));
          }
        }
        points.push(point(x,high,BASE));
      }
      return points;
    }
    for (let i = 0; i+1 < xs.length; i++) {
      const start = xs[i], end = xs[i+1], length = end-start;
      const changing = data.some(row=>row[i]!==row[i+1]);
      const positions = changing ? sortedUnique([start,start+CREST_HALF_X,
        ...[0.25,0.375,0.5,0.625,0.75].map(t=>start+length*t),end-CREST_HALF_X]) : [start];
      if (i+2===xs.length) positions.push(end);
      for (const x of positions) {
        coordinates.push(x);
        sections.push(section(x,i));
      }
    }
    for (let i = 0; i+1 < sections.length; i++) {
      const a = sections[i], b = sections[i+1];
      for (let j = 0; j+1 < a.length; j++) {
        faces.push([a[j],b[j],b[j+1]], [a[j],b[j+1],a[j+1]]);
      }
    }

    // Transition across the narrow, level margin to the original subdivisions
    // of the base. The long edges and the key's extra y bands all remain welded.
    const upperEdge = y => xsAt(y).filter(x=>left<=x && x<=right);
    const side = yCuts.filter(y=>front<=y && y<=back);
    const leftEdge = sections[0].map(p=>p[1]*100);
    const rightEdge = sections[sections.length-1].map(p=>p[1]*100);
    const frontXs = upperEdge(front), backXs = upperEdge(back);
    stitch(faces, frontXs, coordinates, x=>point(x,front,BASE), x=>point(x,sectionFront,BASE), false);
    stitch(faces, side, rightEdge, y=>point(right,y,BASE), y=>point(xs[xs.length-1],y,BASE), false);
    stitch(faces, backXs, coordinates, x=>point(x,back,BASE), x=>point(x,sectionBack,BASE), true);
    stitch(faces, side, leftEdge, y=>point(left,y,BASE), y=>point(xs[0],y,BASE), true);
  }

  function buildSolid(rectangles, buildings = [], field = null) {
    const ys = sortedUnique(rectangles.flatMap(r => [r.front, r.back]));
    const right = Math.max(...rectangles.map(r => r.right));
    const empty = makeBand(0, right, []);
    const bands = [];
    for (let i = 0; i + 1 < ys.length; i++) {
      bands.push(makeBand(0, right, rectangles.filter(r => r.front <= ys[i] && r.back > ys[i])));
    }
    const seams = ys.map((_, i) => sortedUnique([...(bands[i-1] ?? empty).xs, ...(bands[i] ?? empty).xs]));
    const faces = [];
    const physicalHeight = z => z===CONTOUR_PATCH ? BASE : z;
    function verticalEdge(x, seam, bottom, top) {
      const before = bands[seam-1] ?? empty, after = bands[seam] ?? empty;
      const levels = [heightAt(before,x-0.5), heightAt(before,x+0.5), heightAt(after,x-0.5), heightAt(after,x+0.5)];
      return sortedUnique([bottom, top, ...levels.map(physicalHeight).filter(z => z > bottom && z < top)]);
    }
    for (let row = 0; row < bands.length; row++) {
      const {xs, heights} = bands[row], front = ys[row], back = ys[row + 1];
      for (let col = 0; col < heights.length; col++) {
        const left = xs[col], rightEdge = xs[col + 1], h = heights[col];
        if (!h) continue;
        const a = seams[row].filter(x => x >= left && x <= rightEdge);
        const b = seams[row + 1].filter(x => x >= left && x <= rightEdge);
        if (h !== FOOT && h !== CONTOUR_PATCH) {
          stitch(faces, a, b, x => point(x, front, h), x => point(x, back, h), false);
        }
        stitch(faces, a, b, x => point(x, front, 0), x => point(x, back, 0), true);
      }
      for (let col = 0; col < xs.length; col++) {
        const left = physicalHeight(heights[col-1] ?? 0), next = physicalHeight(heights[col] ?? 0), x = xs[col];
        if (left === next) continue;
        const low = Math.min(left, next), high = Math.max(left, next);
        stitch(faces, verticalEdge(x, row, low, high), verticalEdge(x, row + 1, low, high),
          z => point(x, front, z), z => point(x, back, z), left > next);
      }
    }
    for (let seam = 0; seam < ys.length; seam++) {
      const before = bands[seam - 1] ?? empty, after = bands[seam] ?? empty;
      const xs = seams[seam], y = ys[seam];
      for (let i = 0; i + 1 < xs.length; i++) {
        const x0 = xs[i], x1 = xs[i + 1], mid = (x0 + x1) / 2;
        const front = physicalHeight(heightAt(before, mid)), back = physicalHeight(heightAt(after, mid));
        if (front === back) continue;
        const low = Math.min(front, back), high = Math.max(front, back);
        stitch(faces, verticalEdge(x0, seam, low, high), verticalEdge(x1, seam, low, high),
          z => point(x0, y, z), z => point(x1, y, z), front < back);
      }
    }
    const seamAt = new Map(ys.map((y,i) => [y,seams[i]]));
    for (const building of buildings) addBuilding(faces, building, y => seamAt.get(y), ys);
    if (field) addContours(faces, field, y => seamAt.get(y), ys);
    return faces;
  }

  function createModel({weeks, label = "", year, style = "towers"}) {
    if (style !== "towers" && style !== "contour") throw new Error("Choose towers or contour style.");
    if (!Array.isArray(weeks) || weeks.length < 52 || weeks.length > 54) {
      throw new Error("Use 52 to 54 weeks for a single calendar year.");
    }
    for (const week of weeks) {
      if (!Array.isArray(week) || week.length !== 7 ||
          Array.from(week).some(value => !Number.isSafeInteger(value) || value < 0)) {
        throw new Error("Each week needs seven nonnegative whole-number counts, Sunday first.");
      }
    }
    if (!Number.isInteger(year) || year < 1000 || year > 9999) throw new Error("Enter a four-digit year.");
    const printedLabel = printableLabel(label);
    const engravedText = printedLabel ? printedLabel + " / " + year : String(year);
    const layers = plinth(BODY_LENGTH, true);
    engrave(layers, engravedText);
    const buildings = [];
    const max = Math.max(...weeks.flat());
    const logScale = Math.log(Math.max(12, max));
    const gridLeft = 780, gridRight = BODY_LENGTH - 500, gridFront = 1150;
    const xPitch = (gridRight - gridLeft) / weeks.length, yPitch = 338, gap = 60;
    const contour = style === "contour" && max ? {
      ...rect(gridLeft,gridFront,gridRight,gridFront+7*yPitch,CONTOUR_PATCH),
      centers:weeks.map((_,i)=>(Math.round(gridLeft+i*xPitch)+Math.round(gridLeft+(i+1)*xPitch))/2),
      heights:Array.from({length:7},()=>new Array(weeks.length).fill(0))
    } : null;
    if (contour) layers.push(contour);
    let maxHeight = BASE;
    weeks.forEach((week, weekIndex) => week.forEach((count, day) => {
      if (!count) return;
      // Log scaling keeps quiet days visible in a year with a large release.
      // Heights land on whole 0.2 mm layers and one contribution rises 2 mm.
      const towerHeight = 200 + 20 * Math.round(90 * Math.log(count) / logScale);
      const left = Math.round(gridLeft + weekIndex * xPitch) + gap / 2;
      const right = Math.round(gridLeft + (weekIndex + 1) * xPitch) - gap / 2;
      const y = gridFront + (6 - day) * yPitch + gap / 2;
      const footprint = rect(left, y, right, y + yPitch - gap, FOOT);
      if (contour) contour.heights[6-day][weekIndex]=towerHeight;
      else layers.push(footprint);
      maxHeight = Math.max(maxHeight, BASE + towerHeight);
      const form = towerHeight < 500 ? "pavilion" : towerHeight < 960 ? "folded" :
        towerHeight < 1560 ? "setback" : "lantern";
      buildings.push({...footprint, rise:towerHeight, form:contour ? "ridge" : form, week:weekIndex, day, count});
    }));
    const towers = buildings.map(b => ({
      x:millimeters(b.left), y:millimeters(b.front), w:millimeters(b.right-b.left),
      d:millimeters(b.back-b.front), h:millimeters(b.rise), week:b.week, day:b.day, count:b.count, form:b.form
    }));
    return {
      style, body:buildSolid(layers, contour ? [] : buildings, contour), cap:buildSolid(plinth(CAP_LENGTH, false)),
      width:millimeters(BODY_LENGTH + KEY), depth:millimeters(DEPTH), height:millimeters(maxHeight),
      baseHeight:millimeters(BASE), joinX:millimeters(BODY_LENGTH), capWidth:millimeters(CAP_LENGTH),
      assembledWidth:millimeters(BODY_LENGTH + CAP_LENGTH), clearance:millimeters(CLEARANCE),
      label:printedLabel, engravedText, towers
    };
  }

  function layout(model, arrangement = "assembled") {
    if (arrangement === "assembled") {
      return {capOffset:[model.joinX,0,0], width:model.joinX+model.capWidth, depth:model.depth, height:model.height};
    }
    if (arrangement === "plate") {
      return {capOffset:[0,model.depth+4,0], width:model.width, depth:2*model.depth+4, height:model.height};
    }
    throw new Error("Choose assembled or plate layout.");
  }

  function toSTL(triangles) {
    const bytes = new Uint8Array(84 + triangles.length * 50);
    const view = new DataView(bytes.buffer);
    const header = "Calendar skyline | units: millimeters";
    for (let i = 0; i < header.length; i++) bytes[i] = header.charCodeAt(i);
    view.setUint32(80, triangles.length, true);
    let offset = 84;
    for (const [a, b, c] of triangles) {
      const ux = b[0]-a[0], uy = b[1]-a[1], uz = b[2]-a[2];
      const vx = c[0]-a[0], vy = c[1]-a[1], vz = c[2]-a[2];
      const nx = uy*vz-uz*vy, ny = uz*vx-ux*vz, nz = ux*vy-uy*vx;
      const magnitude = Math.hypot(nx, ny, nz);
      if (!Number.isFinite(magnitude) || !magnitude) throw new Error("A triangle has an invalid area.");
      for (const vector of [[nx/magnitude,ny/magnitude,nz/magnitude],a,b,c]) {
        for (const component of vector) {
          view.setFloat32(offset, component, true);
          offset += 4;
        }
      }
      offset += 2; // The zeroed STL attribute-byte count.
    }
    return bytes;
  }

  const api = {createModel, layout, toSTL, printableLabel, labelLimit:LABEL_LIMIT};
  root.SkylineMesh = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
