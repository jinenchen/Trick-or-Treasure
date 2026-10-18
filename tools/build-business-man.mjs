// Reproducible custom rig for the user-provided Business man FBX by PropShop.
// License: CC BY 4.0. Source and modification credits are embedded in GLB extras.
// Run in a browser with a `three` import map matching r169, FBXLoader and GLTFExporter.
// Await all FBX textures before calling buildBusinessManGLB(). The loader/exporter
// can be obtained from https://github.com/mrdoob/three.js/tree/r169/examples/jsm .
// This preserves the supplied triangles, UVs, material groups and texture resolution.
// pose() is a preview/stress helper; runtime uses src/player-avatar.js IK.
import * as THREE from 'three';
const clamp=(n,a=0,b=1)=>Math.max(a,Math.min(b,n));
const smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a));return t*t*(3-2*t)};

export function createBusinessManRig(source) {
  if(!source)throw new Error('Expected provided static mesh');
  source.updateMatrix();
  const geometry=source.geometry.clone().applyMatrix4(source.matrix);
  const originals=Array.isArray(source.material)?source.material:[source.material];
  const material=originals.map(m=>{
    const p=new THREE.MeshStandardMaterial({name:m.name,color:m.color,map:m.map,
      normalMap:m.normalMap,bumpMap:m.bumpMap,bumpScale:m.bumpScale,alphaMap:m.alphaMap,
      opacity:m.opacity,transparent:m.transparent,alphaTest:m.alphaTest,side:m.side,
      roughness:0.86,metalness:0,emissive:0});
    if(m.normalScale)p.normalScale.copy(m.normalScale);
    return p;
  });
  const actor=new THREE.Group();actor.name='Business_man';
  actor.userData={source:'Business man by PropShop (syedabbas0815)',sourceURL:'https://sketchfab.com/3d-models/business-man-3cff4eb8fe204564aea0c1d1ebef92b6',license:'CC-BY-4.0',modifications:'Original humanoid skeleton and smooth skin weights added to user-supplied static FBX; geometry and UVs preserved, Y-up transform baked, erroneous white FBX emission removed.'};
  const bones=[],byName={},anchors={};
  const bone=(name,parent,world)=>{
    const b=new THREE.Bone();b.name='mixamorig'+name;anchors[name]=new THREE.Vector3(...world);
    b.position.copy(anchors[name]);if(parent)b.position.sub(anchors[parent]);
    (parent?byName[parent]:actor).add(b);byName[name]=b;bones.push(b);return b;
  };
  bone('Hips',null,[0,.98,-.018]);
  bone('Spine','Hips',[0,1.11,-.01]);
  bone('Spine1','Spine',[0,1.27,-.015]);
  bone('Spine2','Spine1',[0,1.43,-.025]);
  bone('Neck','Spine2',[0,1.595,-.025]);
  bone('Head','Neck',[0,1.685,-.035]);
  for(const [side,sign] of [['Left',1],['Right',-1]]){
    bone(side+'Shoulder','Spine2',[sign*.115,1.515,-.035]);
    bone(side+'Arm',side+'Shoulder',[sign*.225,1.515,-.035]);
    bone(side+'ForeArm',side+'Arm',[sign*.49,1.485,-.035]);
    bone(side+'Hand',side+'ForeArm',[sign*.745,1.485,-.027]);
    bone(side+'HandPalm',side+'Hand',[sign*.800,1.485,-.022]);
    bone(side+'UpLeg','Hips',[sign*.095,.935,-.018]);
    bone(side+'Leg',side+'UpLeg',[sign*.105,.495,.007]);
    bone(side+'Foot',side+'Leg',[sign*.104,.09,.018]);
    bone(side+'ToeBase',side+'Foot',[sign*.104,.025,.155]);
  }
  const indexByName=new Map(bones.map((b,i)=>[b.name.slice(9),i]));
  const indices=new Uint16Array(geometry.attributes.position.count*4),weights=new Float32Array(indices.length);
  const torso=(y)=>{
    const transitions=[['Hips','Spine',1.05,1.18],['Spine','Spine1',1.20,1.34],['Spine1','Spine2',1.35,1.46],['Spine2','Neck',1.55,1.625],['Neck','Head',1.625,1.69]];
    let previous='Hips';for(const [from,to,a,b] of transitions){if(y<a)return [[previous,1]];if(y<b){const t=smooth(a,b,y);return[[from,1-t],[to,t]]}previous=to}return[['Head',1]];
  };
  const arm=(side,x,y)=>{
    const shoulder=smooth(.15,.29,x);
    let limb;
    if(x<.425)limb=[[side+'Arm',1]];
    else if(x<.555){const t=smooth(.425,.555,x);limb=[[side+'Arm',1-t],[side+'ForeArm',t]]}
    else if(x<.70)limb=[[side+'ForeArm',1]];
    else if(x<.785){const t=smooth(.70,.785,x);limb=[[side+'ForeArm',1-t],[side+'Hand',t]]}
    else limb=[[side+'Hand',1]];
    return [[side+'Shoulder',1-shoulder],...limb.map(([n,w])=>[n,w*shoulder])];
  };
  const leg=(side,y,z)=>{
    if(y>.565)return[[side+'UpLeg',1]];
    if(y>.425){const t=smooth(.425,.565,y);return[[side+'Leg',1-t],[side+'UpLeg',t]]}
    if(y>.17)return[[side+'Leg',1]];
    if(y>.06){const t=smooth(.06,.17,y);return[[side+'Foot',1-t],[side+'Leg',t]]}
    const t=smooth(.12,.19,z);return[[side+'Foot',1-t],[side+'ToeBase',t]];
  };
  const p=geometry.attributes.position;
  for(let i=0;i<p.count;i++){
    const x=p.getX(i),y=p.getY(i),z=p.getZ(i),ax=Math.abs(x),side=x>=0?'Left':'Right',influences=new Map();
    const add=(list,factor)=>{for(const[n,w]of list)if(w*factor>0)influences.set(n,(influences.get(n)||0)+w*factor)};
    if(y<1.06){
      const pelvis=smooth(.83,1.03,y);add(torso(y),pelvis);
      const sideMix=smooth(-.035,.035,x),blendSides=smooth(.73,.87,y);
      const leftWeight=(x>=0?1:0)*(1-blendSides)+sideMix*blendSides;
      add(leg('Left',y,z),(1-pelvis)*leftWeight);add(leg('Right',y,z),(1-pelvis)*(1-leftWeight));
    } else {
      const armWeight=smooth(.14,.275,ax)*smooth(1.31,1.415,y)*(1-smooth(1.57,1.67,y));
      add(torso(y),1-armWeight);add(arm(side,ax,y),armWeight);
    }
    const ordered=[...influences].sort((a,b)=>b[1]-a[1]).slice(0,4),sum=ordered.reduce((s,x)=>s+x[1],0);
    if(!sum||!Number.isFinite(sum))throw new Error('Invalid weight '+i);
    for(let j=0;j<ordered.length;j++){indices[i*4+j]=indexByName.get(ordered[j][0]);weights[i*4+j]=ordered[j][1]/sum;}
  }
  geometry.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(indices,4));
  geometry.setAttribute('skinWeight',new THREE.Float32BufferAttribute(weights,4));
  const mesh=new THREE.SkinnedMesh(geometry,material);mesh.name='avaturn_look_0';mesh.frustumCulled=false;
  actor.add(mesh);actor.updateMatrixWorld(true);mesh.bind(new THREE.Skeleton(bones));
  actor.animations=[];
  let maxBindDelta=0,maxWeightError=0,invalidWeights=0;
  const v=new THREE.Vector3(),w=new THREE.Vector3();mesh.skeleton.update();
  for(let i=0;i<p.count;i++){
    v.fromBufferAttribute(p,i);w.copy(v);mesh.applyBoneTransform(i,w);maxBindDelta=Math.max(maxBindDelta,v.distanceTo(w));
    let sum=0;for(let j=0;j<4;j++){const n=weights[i*4+j];sum+=n;if(!Number.isFinite(n)||n<0||indices[i*4+j]>=bones.length)invalidWeights++;}maxWeightError=Math.max(maxWeightError,Math.abs(sum-1));
  }
  actor.updateMatrixWorld(true);
  const rest=bones.map(b=>({b,position:b.position.clone(),quaternion:b.quaternion.clone()}));
  const reset=()=>{for(const r of rest){r.b.position.copy(r.position);r.b.quaternion.copy(r.quaternion)}actor.updateMatrixWorld(true)};
  const pose=(kind,t=0)=>{
    reset();
    for(const [side,sign]of[['Left',1],['Right',-1]]){
      byName[side+'Arm'].rotation.z=-sign*1.30;
      byName[side+'ForeArm'].rotation.y=sign*-.18;
      if(kind==='walk'){
        const stride=Math.sin(t+(sign===1?0:Math.PI));
        byName[side+'UpLeg'].rotation.x=stride*.48;
        byName[side+'Leg'].rotation.x=Math.max(0,-stride)*.72;
        byName[side+'Arm'].rotation.x=-stride*.25;
        byName[side+'ForeArm'].rotation.y=sign*-.35;
        byName[side+'Foot'].rotation.x=-Math.max(0,-stride)*.3;
      }
      if(kind==='crouch'){
        byName[side+'UpLeg'].rotation.x=-.82;
        byName[side+'Leg'].rotation.x=1.45;
        byName[side+'Foot'].rotation.x=-.65;
        byName[side+'Arm'].rotation.z=-sign*.88;
        byName[side+'Arm'].rotation.y=-sign*.65;
        byName[side+'ForeArm'].rotation.y=-sign*.75;
      }
    }
    if(kind==='crouch'){byName.Hips.position.y-=.22;byName.Spine.rotation.x=.2;byName.Spine1.rotation.x=.16;byName.Head.rotation.x=-.16;}
    if(kind==='bind')reset();actor.updateMatrixWorld(true);mesh.skeleton.update();
  };
  const result={bones:bones.map(b=>({name:b.name,parent:b.parent?.name,position:b.position.toArray(),bindWorld:anchors[b.name.slice(9)].toArray()})),vertices:p.count,triangles:p.count/3,maxBindDelta,maxWeightError,invalidWeights,groups:geometry.groups,materials:material.map(m=>m.name)};
  return { actor, mesh, bones, byName, anchors, reset, pose, result };
}

// Pass the fully loaded user-supplied FBX root and the official r169 exporter.
// Example: const { binary, report } = await buildBusinessManGLB(fbx, GLTFExporter);
// Write binary as assets/models/sketchfab/business-man.glb. No source model is fetched.
export async function buildBusinessManGLB(fbxRoot, GLTFExporter) {
  let source=null;
  fbxRoot.traverse(node=>{if(node.isMesh){if(source)throw new Error('Expected one supplied mesh');source=node;}});
  if(!source)throw new Error('FBX contains no mesh');
  const rig=createBusinessManRig(source);
  rig.reset();
  const binary=await new GLTFExporter().parseAsync(rig.actor,{binary:true,trs:true,onlyVisible:false});
  return {binary,report:rig.result,rig};
}