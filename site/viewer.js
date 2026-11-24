"use strict";

// The browser and the print proof share the same orthographic studio renderer.
// All visible surfaces, including shadows and inscriptions, come from the STL triangles.
const SkylineViewer = (() => {
  const finishes = Object.freeze({
    Evergreen: [0.145, 0.365, 0.338],
    Glacier: [0.22, 0.47, 0.60],
    Marigold: [0.69, 0.42, 0.18]
  });
  const poses = {
    iso: {yaw: .50, elevation: .445},
    front: {yaw: 0, elevation: 0},
    top: {yaw: 0, elevation: Math.PI / 2}
  };
  const proofSize = Object.freeze({width: 1920, height: 820});
  const limits = Object.freeze({min: .70, max: 2.4});
  const clamp = (value, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, value));
  const normalize = (x,y,z) => { const k = 1 / Math.hypot(x,y,z); return [x*k,y*k,z*k]; };
  const light = normalize(-.62, -.68, 1.15);
  const fill = normalize(.72, .24, .64);
  const overhead = {right:[1,0,0], up:[0,1,0], eye:[0,0,1]};
  const scenes = new WeakMap();

  function cameraAxes(yaw, elevation) {
    const x = Math.cos(yaw), y = Math.sin(yaw);
    const s = Math.sin(elevation), c = Math.cos(elevation);
    return {right:[x,y,0], up:[-y*s,x*s,c], eye:[y*c,-x*c,s]};
  }

  function arrangementFor(model, layout) {
    const mesh = typeof SkylineMesh !== "undefined" ? SkylineMesh :
      (typeof require === "function" ? require("./mesh.js") : null);
    if (mesh && typeof mesh.layout === "function") return mesh.layout(model,layout);
    const plate = layout === "plate";
    return {
      capOffset: plate ? [0,model.depth+4,0] : [model.joinX,0,0],
      width: plate ? model.width : model.assembledWidth,
      depth: plate ? model.depth*2+4 : model.depth, height:model.height
    };
  }

  function geometry(model, layout) {
    const placement = arrangementFor(model,layout);
    const vertices = [], triangles = [], normal = [], material = [];
    const index = new Map();
    function register(p, shift) {
      const x = p[0]+shift[0], y = p[1]+shift[1], z = p[2]+shift[2];
      const key = x+","+y+","+z;
      let id = index.get(key);
      if (id === undefined) { id=vertices.length/3; index.set(key,id); vertices.push(x,y,z); }
      return id;
    }
    for (const [part, shift, body] of [[model.body,[0,0,0],true], [model.cap,placement.capOffset,false]]) {
      for (const [a,b,c] of part) {
        const ux=b[0]-a[0], uy=b[1]-a[1], uz=b[2]-a[2];
        const vx=c[0]-a[0], vy=c[1]-a[1], vz=c[2]-a[2];
        const x=uy*vz-uz*vy, y=uz*vx-ux*vz, z=ux*vy-uy*vx;
        const len=Math.hypot(x,y,z);
        if (!len) continue;
        triangles.push(register(a,shift),register(b,shift),register(c,shift));
        normal.push(x/len,y/len,z/len);
        const low=Math.min(a[2],b[2],c[2]), high=Math.max(a[2],b[2],c[2]);
        const tower=body && high>model.baseHeight+.001;
        const cut=body && !tower && low>.001 && low<model.baseHeight-.001;
        material.push(tower ? 1 : cut ? 2 : 0);
      }
    }
    const scene={xyz:new Float32Array(vertices), tri:new Uint32Array(triangles), normal:new Float32Array(normal),
      material:new Uint8Array(material), placement};
    if(model.style==="contour")smoothContours(scene);
    return scene;
  }

  // Only the raised contour field shares a tangent. Angle weighting keeps the
  // highlights consistent across its unevenly spaced triangles and level crests.
  // Leave the plinth, cut lettering and architecture on their physical face normals.
  function smoothContours(scene) {
    const {tri,xyz,normal,material}=scene;
    const vertices=new Float32Array(xyz.length),soft=new Uint8Array(material.length);
    for(let f=0;f<tri.length;f+=3) {
      if(material[f/3]!==1||normal[f+2]<=0)continue;
      soft[f/3]=1;
      const a=tri[f]*3,b=tri[f+1]*3,c=tri[f+2]*3;
      const abx=xyz[b]-xyz[a],aby=xyz[b+1]-xyz[a+1],abz=xyz[b+2]-xyz[a+2];
      const acx=xyz[c]-xyz[a],acy=xyz[c+1]-xyz[a+1],acz=xyz[c+2]-xyz[a+2];
      const bcx=xyz[c]-xyz[b],bcy=xyz[c+1]-xyz[b+1],bcz=xyz[c+2]-xyz[b+2];
      const ab=Math.hypot(abx,aby,abz),ac=Math.hypot(acx,acy,acz),bc=Math.hypot(bcx,bcy,bcz);
      const atA=Math.acos(clamp((abx*acx+aby*acy+abz*acz)/(ab*ac),-1,1));
      const atB=Math.acos(clamp(-(abx*bcx+aby*bcy+abz*bcz)/(ab*bc),-1,1));
      const atC=Math.PI-atA-atB;
      for(let axis=0;axis<3;axis++) {
        const n=normal[f+axis];
        vertices[a+axis]+=atA*n;vertices[b+axis]+=atB*n;vertices[c+axis]+=atC*n;
      }
    }
    for(let i=0;i<vertices.length;i+=3) {
      const len=Math.hypot(vertices[i],vertices[i+1],vertices[i+2]);
      if(len){vertices[i]/=len;vertices[i+1]/=len;vertices[i+2]/=len;}
    }
    scene.softFaces=soft;scene.smoothNormals=vertices;
  }

  function coordinates(xyz, axes) {
    const points=new Float32Array(xyz.length);
    let minX=Infinity, minY=Infinity, maxX=-Infinity, maxY=-Infinity;
    const r=axes.right, u=axes.up, e=axes.eye;
    for (let i=0;i<xyz.length;i+=3) {
      const x=xyz[i], y=xyz[i+1], z=xyz[i+2];
      const px=x*r[0]+y*r[1]+z*r[2], py=x*u[0]+y*u[1]+z*u[2];
      points[i]=px; points[i+1]=py; points[i+2]=x*e[0]+y*e[1]+z*e[2];
      minX=Math.min(minX,px); maxX=Math.max(maxX,px); minY=Math.min(minY,py); maxY=Math.max(maxY,py);
    }
    return {points,minX,minY,maxX,maxY};
  }

  // A single depth rasterizer serves the light atlas, terrain field and camera.
  // Camera coverage also records a face and interpolated sky visibility per sample.
  function drawDepth(scene, projected, axes, width, height, recordSurface) {
    const depth = new Float32Array(width*height).fill(-1e6);
    const faces = recordSurface ? new Int32Array(width*height).fill(-1) : null;
    const sky = recordSurface ? new Uint8Array(width*height) : null;
    const weights = recordSurface && scene.softFaces ? new Uint16Array(width*height) : null;
    const {tri, normal, exposure} = scene, eye=axes.eye;
    for (let f=0;f<tri.length;f+=3) {
      if(normal[f]*eye[0]+normal[f+1]*eye[1]+normal[f+2]*eye[2]<=.000001)continue;
      const ia=tri[f]*3, ib=tri[f+1]*3, ic=tri[f+2]*3;
      const ax=projected[ia], ay=projected[ia+1], az=projected[ia+2];
      const bx=projected[ib], by=projected[ib+1], bz=projected[ib+2];
      const cx=projected[ic], cy=projected[ic+1], cz=projected[ic+2];
      const left=Math.max(0,Math.ceil(Math.min(ax,bx,cx)-.5));
      const right=Math.min(width-1,Math.floor(Math.max(ax,bx,cx)-.5));
      const top=Math.max(0,Math.ceil(Math.min(ay,by,cy)-.5));
      const bottom=Math.min(height-1,Math.floor(Math.max(ay,by,cy)-.5));
      if(left>right || top>bottom)continue;
      const denom=(by-cy)*(ax-cx)+(cx-bx)*(ay-cy);
      if(Math.abs(denom)<1e-9)continue;
      const awx=(by-cy)/denom, awy=(cx-bx)/denom, bwx=(cy-ay)/denom, bwy=(ax-cx)/denom;
      const dx=left+.5-cx, dy=top+.5-cy;
      let waRow=awx*dx+awy*dy, wbRow=bwx*dx+bwy*dy;
      const dzA=az-cz,dzB=bz-cz;
      const cSky=sky?exposure[f+2]:0, skyA=sky?exposure[f]-cSky:0, skyB=sky?exposure[f+1]-cSky:0;
      const smooth=weights && scene.softFaces[f/3];
      for(let y=top;y<=bottom;y++,waRow+=awy,wbRow+=bwy) {
        let wa=waRow,wb=wbRow,p=y*width+left;
        for(let x=left;x<=right;x++,p++,wa+=awx,wb+=bwx) {
          if(wa<-.000001 || wb<-.000001 || wa+wb>1.000001)continue;
          const z=cz+wa*dzA+wb*dzB;
          if(z<depth[p])continue;
          depth[p]=z;
          if(faces){faces[p]=f;sky[p]=cSky+wa*skyA+wb*skyB;}
          if(smooth)weights[p]=(Math.round(wa*255)<<8)|Math.round(wb*255);
        }
      }
    }
    return {depth,faces,sky,weights};
  }

  function atlas(scene, axes, resolution) {
    const p=coordinates(scene.xyz,axes), pad=3;
    const width=Math.ceil((p.maxX-p.minX)*resolution)+2*pad+1;
    const height=Math.ceil((p.maxY-p.minY)*resolution)+2*pad+1;
    const ox=pad-p.minX*resolution, oy=pad-p.minY*resolution;
    for(let i=0;i<p.points.length;i+=3) {
      p.points[i]=p.points[i]*resolution+ox;
      p.points[i+1]=p.points[i+1]*resolution+oy;
    }
    return {axes,width,height,ox,oy,resolution,data:drawDepth(scene,p.points,axes,width,height,false).depth};
  }

  const compass=Array.from({length:8},(_,k)=>[Math.cos(k*Math.PI/4),Math.sin(k*Math.PI/4)]);
  function skyVisibility(scene, top) {
    const result=new Uint8Array(scene.tri.length), cache=new Map();
    for(let f=0;f<scene.tri.length;f+=3) {
      const smooth=scene.softFaces?.[f/3], normals=smooth?scene.smoothNormals:scene.normal;
      const normalId=smooth?"":Math.round(normals[f]*100)+"/"+Math.round(normals[f+1]*100)+"/"+Math.round(normals[f+2]*100);
      for(let k=0;k<3;k++) {
        const vi=scene.tri[f+k], key=smooth?vi:vi+":"+normalId;
        let sky=cache.get(key);
        if(sky===undefined) {
          const ni=smooth?vi*3:f, nx=normals[ni],ny=normals[ni+1],nz=normals[ni+2];
          const i=vi*3,x=scene.xyz[i]+nx*.42,y=scene.xyz[i+1]+ny*.42,z=scene.xyz[i+2]+nz*.42;
          let block=0,weight=0;
          for(const [dx,dy] of compass) {
            const facing=nx*dx+ny*dy;
            const importance=clamp(.45+nz*.55+facing*.70);
            if(!importance)continue;
            let horizon=0;
            for(const distance of [1.2,3.5,8]) {
              const sx=Math.floor((x+dx*distance)*top.resolution+top.ox);
              const sy=Math.floor((y+dy*distance)*top.resolution+top.oy);
              if(sx<0||sy<0||sx>=top.width||sy>=top.height)continue;
              const rise=top.data[sy*top.width+sx]-z;
              if(rise>0)horizon=Math.max(horizon,rise/(rise+distance));
            }
            block+=importance*horizon;weight+=importance;
          }
          sky=Math.round(255*(1-.77*block/Math.max(weight,.001)));cache.set(key,sky);
        }
        result[f+k]=sky;
      }
    }
    return result;
  }

  function bilinear(data,i,stride,dx,dy) {
    const a=data[i]+(data[i+1]-data[i])*dx;
    const b=data[i+stride]+(data[i+stride+1]-data[i+stride])*dx;
    return a+(b-a)*dy;
  }

  // Each slice stores coverage of the studio light at a receiver height. Blurring
  // coverage before interpolation gives the real triangles penumbras without depth stripes.
  function softShadows(scene) {
    const axes=cameraAxes(Math.atan2(light[0],-light[1]),Math.asin(light[2]));
    const map=atlas(scene,axes,3.5);
    const {width:w,height:h,data}=map, top=scene.placement.height, step=1.1;
    const blocker=new Float32Array(w*h);
    for(let y=0;y<h;y++) {
      const v=(y+.5-map.oy)/map.resolution;
      for(let x=0;x<w;x++) {
        const i=y*w+x;
        blocker[i]=Math.max(0,axes.up[2]*v+axes.eye[2]*data[i]);
      }
    }
    const levels=[];
    for(let z=0;z<=top+2*step;z+=step) {
      const raw=new Float32Array(w*h);
      for(let i=0;i<raw.length;i++)raw[i]=clamp((blocker[i]-z-.40)*1.4);
      const softness=1+Math.round(2*clamp(1-z/top));
      const filtered=blur(blur(raw,w,h,softness),w,h,softness);
      const level=new Uint8Array(filtered.length);
      for(let i=0;i<level.length;i++)level[i]=Math.round(255*filtered[i]);
      levels.push(level);
    }
    return {axes,width:w,height:h,ox:map.ox,oy:map.oy,resolution:map.resolution,step,levels};
  }

  function shadowAt(map,x,y,z) {
    const r=map.axes.right,u=map.axes.up;
    const sx=(x*r[0]+y*r[1])*map.resolution+map.ox-.5;
    const sy=(x*u[0]+y*u[1]+z*u[2])*map.resolution+map.oy-.5;
    const ix=Math.floor(sx),iy=Math.floor(sy),w=map.width;
    if(ix<0||iy<0||ix+1>=w||iy+1>=map.height)return 0;
    const level=Math.max(0,(z+.24)/map.step),lo=Math.floor(level);
    if(lo+1>=map.levels.length)return 0;
    const p=iy*w+ix,dx=sx-ix,dy=sy-iy;
    const lower=bilinear(map.levels[lo],p,w,dx,dy);
    return (lower+(bilinear(map.levels[lo+1],p,w,dx,dy)-lower)*(level-lo))/255;
  }

  function deckOcclusion(top,baseHeight) {
    const coverage=Float32Array.from(top.data,z=>clamp((z-baseHeight)*.45));
    const near=blur(coverage,top.width,top.height,3);
    const broad=blur(blur(coverage,top.width,top.height,6),top.width,top.height,7);
    return {width:top.width,height:top.height,ox:top.ox,oy:top.oy,resolution:top.resolution,
      data:Uint8Array.from(near,(v,i)=>Math.round(255*(1-.28*v-.36*broad[i])))};
  }

  // The ground receives a blurred projection of the real skyline. Ambient
  // contact is generated independently from its actual footprint, also on the print bed.
  function blur(src,w,h,radius) {
    const t=new Float32Array(src.length), out=new Float32Array(src.length);
    const n=radius*2+1;
    for(let y=0;y<h;y++) {
      let total=0, row=y*w;
      for(let x=0;x<=radius;x++)total+=src[row+x];
      for(let x=0;x<w;x++) {
        t[row+x]=total/n;
        if(x>=radius)total-=src[row+x-radius];
        if(x+radius+1<w)total+=src[row+x+radius+1];
      }
    }
    for(let x=0;x<w;x++) {
      let total=0;
      for(let y=0;y<=radius;y++)total+=t[y*w+x];
      for(let y=0;y<h;y++) {
        out[y*w+x]=total/n;
        if(y>=radius)total-=t[(y-radius)*w+x];
        if(y+radius+1<h)total+=t[(y+radius+1)*w+x];
      }
    }
    return out;
  }

  function makeGround(scene, top, shadow) {
    const pad=16, tail=12+scene.placement.height, resolution=2;
    const w=Math.ceil((scene.placement.width+pad+tail)*resolution);
    const h=Math.ceil((scene.placement.depth+pad+tail)*resolution);
    const silhouette=new Float32Array(w*h), contact=new Float32Array(w*h);
    for(let y=0;y<h;y++) {
      const py=(y+.5)/resolution-pad;
      const ty=Math.floor(py*top.resolution+top.oy);
      for(let x=0;x<w;x++) {
        const px=(x+.5)/resolution-pad,i=y*w+x;
        silhouette[i]=shadowAt(shadow,px,py,0);
        const tx=Math.floor(px*top.resolution+top.ox);
        if(tx>=0&&tx<top.width&&ty>=0&&ty<top.height&&top.data[ty*top.width+tx]>0)contact[i]=1;
      }
    }
    const cast=blur(blur(silhouette,w,h,3),w,h,6);
    const soft=blur(blur(contact,w,h,5),w,h,9);
    const hard=blur(contact,w,h,2);
    const data=new Uint8Array(w*h);
    for(let i=0;i<data.length;i++)data[i]=255*clamp(.36*cast[i]+.35*soft[i]+.25*hard[i]);
    return {w,h,pad,resolution,data};
  }

  function sceneFor(model,layout) {
    let byLayout=scenes.get(model);
    if(!byLayout){byLayout=new Map();scenes.set(model,byLayout);}
    if(byLayout.has(layout))return byLayout.get(layout);
    const scene=geometry(model,layout);
    const top=atlas(scene,overhead,3);
    scene.shadow=softShadows(scene);
    scene.deck=deckOcclusion(top,model.baseHeight);
    scene.exposure=skyVisibility(scene,top);
    scene.ground=makeGround(scene,top,scene.shadow);
    byLayout.set(layout,scene);
    return scene;
  }

  function faceLighting(scene,eye,finish) {
    const previous=scene.lastLighting;
    if(previous && previous.finish===finish && previous.eye[0]===eye[0] &&
      previous.eye[1]===eye[1] && previous.eye[2]===eye[2])return previous;
    const keyHalf=normalize(light[0]+eye[0],light[1]+eye[1],light[2]+eye[2]);
    const rimHalf=normalize(fill[0]+eye[0],fill[1]+eye[1],fill[2]+eye[2]);
    const pigment=finishes[finish] || finishes.Evergreen;
    const graphite=[.197,.208,.204], cool=[.68,.85,1], warm=[1,.91,.74];
    function illuminate(coeff,k,n,i,material) {
      const nx=n[i],ny=n[i+1],nz=n[i+2],terrain=material===1;
      const color=terrain?pigment:graphite,cut=material===2?.45:1;
      const key=Math.max(0,nx*light[0]+ny*light[1]+nz*light[2]);
      const rim=Math.max(0,nx*fill[0]+ny*fill[1]+nz*fill[2]);
      const shine=Math.pow(Math.max(0,nx*keyHalf[0]+ny*keyHalf[1]+nz*keyHalf[2]),14);
      const rimShine=Math.pow(Math.max(0,nx*rimHalf[0]+ny*rimHalf[1]+nz*rimHalf[2]),10);
      const bounce=.43+.16*Math.max(nz,0)+.25*rim;
      const sheen=terrain?1:.52;
      for(let c=0;c<3;c++) {
        const base=color[c]*255;
        coeff[k+c]=(base*bounce+cool[c]*(9*rim+28*rimShine)*sheen)*cut;
        coeff[k+3+c]=(base*key*.70+warm[c]*(23*key+48*shine)*sheen)*cut;
      }
      coeff[k+6]=key;
      coeff[k+7]=terrain?1:0;
      const reflected=2*(nx*eye[0]+ny*eye[1]+nz*eye[2]);
      coeff[k+8]=reflected*nx-eye[0];coeff[k+9]=reflected*ny-eye[1];coeff[k+10]=reflected*nz-eye[2];
      coeff[k+11]=material===0 && nz>.85 ? 1 : 0;
    }
    const faces=new Float32Array(scene.material.length*12);
    for(let t=0;t<scene.material.length;t++) {
      if(!scene.softFaces?.[t])illuminate(faces,t*12,scene.normal,t*3,scene.material[t]);
    }
    let vertices=null;
    if(scene.smoothNormals) {
      const n=scene.smoothNormals;
      vertices=new Float32Array(n.length*4);
      for(let i=0;i<n.length;i+=3)if(n[i+2]>0)illuminate(vertices,i*4,n,i,1);
    }
    scene.lastLighting={faces,vertices,eye,finish};
    return scene.lastLighting;
  }

  function viewTransform(scene,pose,width,height,sample) {
    const axes=cameraAxes(pose.yaw,pose.elevation),p=coordinates(scene.xyz,axes);
    const midX=(p.minX+p.maxX)/2, midY=(p.minY+p.maxY)/2;
    const unit=Math.min(width*.92/Math.max(1,p.maxX-p.minX),height*.73/Math.max(1,p.maxY-p.minY))*(pose.zoom||1);
    const centerX=width*(.5+(pose.panX||0)),centerY=height*(.505+(pose.panY||0));
    for(let i=0;i<p.points.length;i+=3) {
      p.points[i]=(centerX+(p.points[i]-midX)*unit)*sample;
      p.points[i+1]=(centerY-(p.points[i+1]-midY)*unit)*sample;
    }
    return {axes,points:p.points,unit,midX,midY,centerX,centerY};
  }

  function groundShade(map,x,y) {
    const tx=(x+map.pad)*map.resolution-.5,ty=(y+map.pad)*map.resolution-.5;
    const ix=Math.floor(tx),iy=Math.floor(ty),w=map.w;
    if(ix<0||iy<0||ix+1>=w||iy+1>=map.h)return 0;
    const i=iy*w+ix,fx=tx-ix,fy=ty-iy,d=map.data;
    return ((d[i]*(1-fx)+d[i+1]*fx)*(1-fy)+(d[i+w]*(1-fx)+d[i+w+1]*fx)*fy)/255;
  }

  function render(scene,finish,pose,width,height,sample) {
    const view=viewTransform(scene,pose,width,height,sample),{axes,unit,midX,midY,centerX,centerY}=view;
    const {right,up,eye}=axes, sw=width*sample;
    const {depth,faces,sky,weights}=drawDepth(scene,view.points,axes,sw,height*sample,true);
    const lighting=faceLighting(scene,eye,finish),image=new Uint8ClampedArray(width*height*4);
    const interpolated=new Float64Array(12);
    const color=new Float64Array(3), paper=new Float64Array(3);
    const invDepth=1/scene.placement.height;
    function surface(f,d,ambient,rx,uy,wa,wb) {
      const wx=right[0]*rx+up[0]*uy+eye[0]*d, wy=right[1]*rx+up[1]*uy+eye[1]*d;
      const wz=up[2]*uy+eye[2]*d;
      let coeff=lighting.faces,k=f*4;
      if(scene.softFaces?.[f/3]) {
        const a=scene.tri[f]*12,b=scene.tri[f+1]*12,c=scene.tri[f+2]*12,v=lighting.vertices;
        wa/=255;wb/=255;
        for(let j=0;j<11;j++)interpolated[j]=v[c+j]+wa*(v[a+j]-v[c+j])+wb*(v[b+j]-v[c+j]);
        coeff=interpolated;k=0;
      }
      const key=coeff[k+6];
      const shadow=key>.015?shadowAt(scene.shadow,wx,wy,wz):0;
      if(coeff[k+11]) {
        const deck=scene.deck, dx=wx*deck.resolution+deck.ox-.5, dy=wy*deck.resolution+deck.oy-.5;
        const x=Math.floor(dx),y=Math.floor(dy);
        if(x>=0&&y>=0&&x+1<deck.width&&y+1<deck.height)
          ambient=bilinear(deck.data, y*deck.width+x, deck.width, dx-x, dy-y);
      }
      const ao=.35+.65*ambient/255, terrain=coeff[k+7];
      const skyFactor=ao*(1-.10*shadow);
      const keyFactor=(1-.68*shadow)*(.76+.24*ao)*(1-.095*clamp((wx+.28*wy)/scene.placement.width));
      // Finite overhead and forward softboxes reflect differently along the sculpture.
      // Wide gradients keep satin edges readable on both metal-toned and charcoal PLA.
      const reflectX=coeff[k+8],reflectY=coeff[k+9],reflectZ=coeff[k+10];
      let overheadCard=0,frontCard=0,floorCard=0;
      if(reflectZ>.12) {
        const distance=(82-wz)/reflectZ;
        const x=(wx+distance*reflectX-32)/86,y=(wy+distance*reflectY-30)/65;
        overheadCard=1/(1+x*x*x*x+y*y*y*y);
      }
      if(reflectY<-.12) {
        const distance=(-76-wy)/reflectY;
        const x=(wx+distance*reflectX-136)/73,z=(wz+distance*reflectZ-26)/26;
        frontCard=1/(1+x*x*x*x+z*z*z*z);
      }
      if(reflectZ<-.12) {
        const distance=-wz/reflectZ, gx=wx+distance*reflectX,gy=wy+distance*reflectY;
        const x=(gx-112)/97,y=(gy+13)/45;
        floorCard=(1-groundShade(scene.ground,gx,gy))*clamp((-reflectZ-.10)*2)/(1+.5*x*x+.5*y*y);
      }
      const sheen=(overheadCard*(terrain?26:17)+frontCard*(terrain?35:17)+12*floorCard)*ao*(1-.35*shadow);
      const luster=1+(clamp(wz*invDepth)-.42)*.19*terrain;
      for(let c=0;c<3;c++) {
        const warm=c===0?1:c===1?.96:.86;
        color[c]+=(coeff[k+c]*skyFactor+coeff[k+3+c]*keyFactor)*luster+sheen*warm;
      }
    }
    const inverse=1/unit;
    for(let y=0;y<height;y++) {
      const movieY=(y+.5)/height,uy=midY+(centerY-y-.5)*inverse;
      const floorV=eye[2]>0.001?uy/eye[2]:0;
      for(let x=0;x<width;x++) {
        const rx=midX+(x+.5-centerX)*inverse,i=(y*width+x)*4;
        const sx=x*sample,sy=y*sample,p=sy*sw+sx,f=faces[p];
        const p1=p+1,p2=p+sw,p3=p2+1;
        const uniform=sample===1||(f===faces[p1]&&f===faces[p2]&&f===faces[p3]);
        let n=1;
        if(f<0||!uniform) {
          const filmX=(x+.5)/width;
          const lightPool=5*(.8-movieY)-7*(filmX-.34)**2-6*(movieY-.38)**2;
          const shadow=eye[2]>.001?groundShade(scene.ground,right[0]*rx-right[1]*floorV,right[1]*rx+right[0]*floorV):0;
          paper[0]=245+lightPool-110*shadow;
          paper[1]=242+lightPool-109*shadow;
          paper[2]=232+lightPool-99*shadow;
        }
        if(uniform && f<0) { color.set(paper); }
        else if(uniform) {
          color.fill(0);
          const d=sample===1?depth[p]:(depth[p]+depth[p1]+depth[p2]+depth[p3])*.25;
          const a=sample===1?sky[p]:(sky[p]+sky[p1]+sky[p2]+sky[p3])*.25;
          let wa=0,wb=0;
          if(weights && scene.softFaces[f/3]) {
            const w=weights[p];wa=w>>8;wb=w&255;
            if(sample>1) {
              const w1=weights[p1],w2=weights[p2],w3=weights[p3];
              wa=(wa+(w1>>8)+(w2>>8)+(w3>>8))*.25;wb=(wb+(w1&255)+(w2&255)+(w3&255))*.25;
            }
          }
          surface(f,d,a,rx,uy,wa,wb);
        } else {
          n=.25;color.fill(0);
          for(let yy=0;yy<2;yy++)for(let xx=0;xx<2;xx++) {
            const sp=p+yy*sw+xx;
            if(faces[sp]<0){for(let c=0;c<3;c++)color[c]+=paper[c];}
            else {
              const w=weights?weights[sp]:0;
              surface(faces[sp],depth[sp],sky[sp],rx+(xx-.5)*inverse*.5,uy-(yy-.5)*inverse*.5,w>>8,w&255);
            }
          }
        }
        // Fine dither avoids contour bands in the studio gradient at proof resolution.
        const grain=(((x*17+y*61+(x*y)%97)%17)/16-.5)*.80;
        image[i]=color[0]*n+grain;image[i+1]=color[1]*n+grain;image[i+2]=color[2]*n+grain;image[i+3]=255;
      }
    }
    return image;
  }

  function proofPixels(model,finish="Evergreen",width=proofSize.width,height=proofSize.height) {
    return render(sceneFor(model,"assembled"),finish,{...poses.iso,zoom:1},width,height,2);
  }

  class Viewer {
    constructor(canvas,fallback) {
      this.canvas=canvas;this.fallback=fallback;
      this.view="iso";this.pose={...poses.iso,zoom:1};
      this.layout="assembled";this.finish="Evergreen";
      try {this.context=canvas.getContext("2d",{alpha:false});}catch{this.context=null;}
      if(fallback)fallback.hidden=Boolean(this.context);
      this.pointers=new Map();
      this.listen();
      if(typeof ResizeObserver==="function")new ResizeObserver(()=>this.redraw()).observe(canvas);
      else if(typeof window!=="undefined")window.addEventListener("resize",()=>this.redraw());
    }

    listen() {
      const c=this.canvas;
      c.addEventListener("pointerdown",e=>{
        if(e.pointerType==="mouse"&&e.button!==0)return;
        this.pointers.set(e.pointerId,[e.clientX,e.clientY]);
        if(c.setPointerCapture)c.setPointerCapture(e.pointerId);
        this.settling=false;
      });
      c.addEventListener("pointermove",e=>{
        const before=this.pointers.get(e.pointerId);
        if(!before)return;
        const next=[e.clientX,e.clientY];this.pointers.set(e.pointerId,next);
        if(this.pointers.size===1) {
          if(e.shiftKey)this.zoomBy(1,before,next);
          else this.rotate((next[0]-before[0])*.007,(next[1]-before[1])*.006);
        }
        else if(this.pointers.size===2) {
          const other=[...this.pointers.entries()].find(([id])=>id!==e.pointerId)[1];
          const oldDistance=Math.hypot(before[0]-other[0],before[1]-other[1]);
          const newDistance=Math.hypot(next[0]-other[0],next[1]-other[1]);
          if(oldDistance>6&&newDistance>6) {
            const from=[(before[0]+other[0])*.5,(before[1]+other[1])*.5];
            const to=[(next[0]+other[0])*.5,(next[1]+other[1])*.5];
            this.zoomBy(newDistance/oldDistance,from,to);
          }
        }
      });
      const release=e=>{if(this.pointers.delete(e.pointerId)&&!this.pointers.size)this.redraw();};
      for(const event of ["pointerup","pointercancel","lostpointercapture"])c.addEventListener(event,release);
      c.addEventListener("wheel",e=>{
        if(!e.ctrlKey&&!e.metaKey)return;
        e.preventDefault();this.zoomBy(Math.exp(clamp(-e.deltaY*.012,-.4,.4)),[e.clientX,e.clientY]);
        this.settling=true;clearTimeout(this.timer);
        this.timer=setTimeout(()=>{this.settling=false;this.redraw();},100);
      },{passive:false});
      c.addEventListener("keydown",e=>{
        if(e.altKey||e.ctrlKey||e.metaKey)return;
        if(e.shiftKey && ["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"].includes(e.key)) {
          const rect=c.getBoundingClientRect();
          const dx=e.key==="ArrowRight"?.08:e.key==="ArrowLeft"?-.08:0;
          const dy=e.key==="ArrowDown"?.08:e.key==="ArrowUp"?-.08:0;
          this.zoomBy(1,[0,0],[dx*rect.width,dy*rect.height]);e.preventDefault();return;
        }
        switch(e.key) {
          case "Home":case "0":this.reset();break;
          case "1":this.setView("iso");break;
          case "2":this.setView("front");break;
          case "3":this.setView("top");break;
          case "+":case "=":this.zoomBy(1.2);break;
          case "-":case "_":this.zoomBy(1/1.2);break;
          case "ArrowLeft":this.rotate(-.14,0);break;
          case "ArrowRight":this.rotate(.14,0);break;
          case "ArrowUp":this.rotate(0,.10);break;
          case "ArrowDown":this.rotate(0,-.10);break;
          default:return;
        }
        e.preventDefault();
      });
    }
    notify() {
      const EventType=this.canvas.ownerDocument?.defaultView?.CustomEvent??globalThis.CustomEvent;
      if(EventType)this.canvas.dispatchEvent(new EventType("viewchange",{detail:{view:this.view,zoom:this.pose.zoom,layout:this.layout}}));
    }
    rotate(dx,dy) {
      if(!dx&&!dy)return;
      this.view="custom";this.pose.yaw+=dx;this.pose.elevation=clamp(this.pose.elevation+dy,0,Math.PI/2);
      this.notify();this.redraw();
    }
    zoomBy(factor,from,to=from) {
      if(!Number.isFinite(factor)||factor<=0)return;
      const zoom=clamp(this.pose.zoom*factor,limits.min,limits.max),ratio=zoom/this.pose.zoom;
      let x=(this.pose.panX||0)*ratio,y=(this.pose.panY||0)*ratio;
      // Keep the point under a pinching pair of fingers or a trackpad cursor.
      // A drag with scale 1 is the same transformation with a moving anchor.
      if(from && to) {
        const rect=this.canvas.getBoundingClientRect();
        const cx=(rect.left||0)+rect.width*.5,cy=(rect.top||0)+rect.height*.505;
        if(rect.width&&rect.height) {
          x+=((to[0]-cx)-ratio*(from[0]-cx))/rect.width;
          y+=((to[1]-cy)-ratio*(from[1]-cy))/rect.height;
        }
      }
      const reach=Math.max(0,zoom-1)*.5;
      this.pose.zoom=zoom;this.pose.panX=clamp(x,-reach,reach);this.pose.panY=clamp(y,-reach,reach);
      this.notify();this.redraw();
    }
    setView(name) {
      if(!Object.hasOwn(poses,name))return;
      this.view=name;this.pose={...poses[name],zoom:this.pose.zoom};this.notify();this.redraw();
    }
    reset() { this.pose.zoom=1;this.setView("iso"); }
    setLayout(layout) {
      if(layout!=="assembled"&&layout!=="plate")return;
      this.layout=layout;this.notify();this.redraw();
    }
    setFinish(finish) { if(Object.hasOwn(finishes,finish)){this.finish=finish;this.redraw();} }
    setModel(model) { this.model=model;this.awaitingFirstDraw=true;this.redraw(); }
    redraw() {
      if(this.frame||!this.context||!this.model)return;
      this.frame=requestAnimationFrame(()=>{this.frame=null;this.draw();});
    }
    draw() {
      const c=this.canvas,rect=c.getBoundingClientRect(),moving=this.pointers.size>0||this.settling;
      if(!rect.width||!rect.height)return;
      const budget=moving?160000:1100000;
      const ratio=Math.min(window.devicePixelRatio||1,moving?1:1.7,Math.sqrt(budget/(rect.width*rect.height)));
      const w=Math.max(1,Math.round(rect.width*ratio)),h=Math.max(1,Math.round(rect.height*ratio));
      if(c.width!==w||c.height!==h){c.width=w;c.height=h;}
      const frame=this.context.createImageData(w,h);
      frame.data.set(render(sceneFor(this.model,this.layout),this.finish,this.pose,w,h,moving?1:2));
      this.context.putImageData(frame,0,0);
      c.setAttribute("data-rendered","true");
      if(this.awaitingFirstDraw) {
        this.awaitingFirstDraw=false;
        const EventType=c.ownerDocument?.defaultView?.CustomEvent??globalThis.CustomEvent;
        if(EventType)c.dispatchEvent(new EventType("modeldrawn"));
      }
    }
    async proofPNG({currentView=false}={}) {
      if(!this.model)return null;
      const c=document.createElement("canvas");c.width=proofSize.width;c.height=proofSize.height;
      const ctx=c.getContext("2d");
      if(!ctx||typeof c.toBlob!=="function")return null;
      const frame=ctx.createImageData(c.width,c.height);
      frame.data.set(currentView
        ? render(sceneFor(this.model,this.layout),this.finish,this.pose,c.width,c.height,2)
        : proofPixels(this.model,this.finish));
      ctx.putImageData(frame,0,0);
      const blob=await new Promise(resolve=>c.toBlob(resolve,"image/png"));
      return blob?new Uint8Array(await blob.arrayBuffer()):null;
    }
  }
  return {Viewer,finishes,proofPixels,proofSize,zoomLimits:limits};
})();
if(typeof module!=="undefined"&&module.exports)module.exports=SkylineViewer;
