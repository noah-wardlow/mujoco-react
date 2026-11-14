import test from 'node:test';
import assert from 'node:assert/strict';
import loadMujoco from '@mujoco/mujoco';
import * as THREE from 'three';
import {createClassicPlaneGeometry,createMujocoClassicMaterial} from '../src/rendering/mujocoClassicMaterial';
import {GeomBuilder} from '../src/rendering/GeomBuilder';
import {MujocoAppearance} from '../src/types';
import type {MujocoData,MujocoModel,MujocoModule} from '../src/types';
const mj=await loadMujoco();
const xml=`<mujoco><asset>
  <texture name="rgb" type="2d" builtin="checker" width="4" height="4" rgb1="1 0 0" rgb2="0 1 0" colorspace="sRGB"/>
  <texture name="cube" type="cube" builtin="flat" width="4" height="24" rgb1=".2 .3 .4"/>
  <material name="mat" texture="rgb" rgba=".2 .3 .4 .8" emission=".2" specular=".3" shininess=".4"/>
  <material name="cubeMat" texture="cube"/>
</asset><worldbody><light name="lamp" pos="1 2 3"/>
  <geom name="inherited" type="box" size=".1 .1 .1" material="mat"/>
  <geom name="override" type="box" size=".1 .1 .1" pos="1 0 0" material="mat" rgba=".7 .6 .5 1"/>
  <geom name="cube" type="sphere" size=".1" pos="2 0 0" material="cubeMat"/>
  <geom name="floor" type="plane" size="3.3 3 .125"/>
</worldbody></mujoco>`;
function fixture(){const native=mj.MjModel.from_xml_string(xml),data=new mj.MjData(native);mj.mj_forward(native,data);return {native,data,m:native as unknown as MujocoModel,d:data as unknown as MujocoData};}
const geom=(m:unknown,name:string)=>(mj.mj_name2id as unknown as (m:unknown,k:number,n:string)=>number)(m,5,name);
const close=(a:number,b:number)=>assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`);

test('classic appearance retains native material overrides, texture transfer and per-camera light state',()=>{
 const f=fixture();const a=createMujocoClassicMaterial(f.m,f.d,geom(f.native,'inherited')),b=createMujocoClassicMaterial(f.m,f.d,geom(f.native,'override'));
 try{
  a.uniforms.diffuse.value.toArray().forEach((v:number,i:number)=>close(v,[.2,.3,.4,.8][i]));
  b.uniforms.diffuse.value.toArray().forEach((v:number,i:number)=>close(v,[.7,.6,.5,1][i]));
  close(a.uniforms.emission.value,.2);close(a.uniforms.specular.value,.3);close(a.uniforms.shininess.value,51.2);
  assert.equal(a.depthWrite,false);assert.equal(b.depthWrite,true);
  assert.equal(a.uniforms.colorMap.value.colorSpace,THREE.SRGBColorSpace);
  assert.equal(a.uniforms.colorMap.value.flipY,false);
  a.onBeforeRender(null as any,null as any,null as any,null as any,null as any,null as any);
  assert.equal(a.uniforms.lightCount.value,2); // Native headlight plus one MJCF spot.
  assert.deepEqual(Array.from(a.uniforms.lightMode.value).slice(0,2),[2,0]);
  assert.deepEqual(a.uniforms.lightPos.value[1].toArray(),[1,2,3]);
  const sameTexture=a.uniforms.colorMap.value;assert.equal(b.uniforms.colorMap.value,sameTexture);
  let disposed=0;sameTexture.addEventListener('dispose',()=>disposed++);
  a.dispose();assert.equal(disposed,0);b.dispose();assert.equal(disposed,1);b.dispose();assert.equal(disposed,1);
 }finally{a.dispose();b.dispose();f.data.delete();f.native.delete();}
});
test('classic cube material uses six native faces and linear classic upload semantics',()=>{
 const f=fixture();const material=createMujocoClassicMaterial(f.m,f.d,geom(f.native,'cube'));
 try{
  assert.equal(material.uniforms.useCube.value,true);assert.equal(material.uniforms.useMap.value,false);
  const texture=material.uniforms.cubeMap.value as THREE.CubeTexture;
  assert.equal(texture.images.length,6);assert.equal(texture.colorSpace,THREE.LinearSRGBColorSpace);
  assert.equal((texture.images[0] as unknown as THREE.DataTexture).image.data.length,4*4*4);
 }finally{material.dispose();f.data.delete();f.native.delete();}
});
test('classic finite plane grid preserves native extents; renderer profile remains opt-in',()=>{
 const f=fixture(),g=geom(f.native,'floor');
 const geometry=createClassicPlaneGeometry(f.m,g);
 const builder=new GeomBuilder(mj as unknown as MujocoModule,{appearance:MujocoAppearance.Classic});
 try{
  const positions=geometry.getAttribute('position');let minX=Infinity,maxX=-Infinity;
  for(let i=0;i<positions.count;i++){minX=Math.min(minX,positions.getX(i));maxX=Math.max(maxX,positions.getX(i));}
  close(minX,-3.3);close(maxX,3.3);assert.ok(positions.count>100);
  assert.throws(()=>builder.create(f.m,g),/requires live/);
  const mesh=builder.create(f.m,g,f.d) as THREE.Mesh;assert.equal((mesh.material as THREE.Material).type,'ShaderMaterial');mesh.geometry.dispose();(mesh.material as THREE.Material).dispose();
  const standard=new GeomBuilder(mj as unknown as MujocoModule).create(f.m,g) as THREE.Mesh;
  assert.equal((standard.material as THREE.Material).type,'MeshStandardMaterial');standard.geometry.dispose();(standard.material as THREE.Material).dispose();
 }finally{geometry.dispose();builder.dispose();f.data.delete();f.native.delete();}
});

test('camera defaults and scoped overrides share meshes, restore on failure and reuse owned alternatives', async()=>{
 const {registerSceneAppearance,resolveCameraAppearance,withCameraAppearance}=await import('../src/rendering/sceneAppearance');
 const f=fixture(),root=new THREE.Group(),scene=new THREE.Scene();scene.add(root);
 const builder=new GeomBuilder(mj as unknown as MujocoModule);
 const mesh=builder.create(f.m,geom(f.native,'inherited')) as THREE.Mesh;root.add(mesh);
 const original={geometry:mesh.geometry,material:mesh.material},time=f.data.time,qpos=Array.from(f.data.qpos);
 const dispose=registerSceneAppearance(root,mj as unknown as MujocoModule,f.m,f.d,MujocoAppearance.Standard);
 try{
  assert.equal(resolveCameraAppearance(scene),MujocoAppearance.Classic);
  assert.equal(resolveCameraAppearance(new THREE.Scene()),MujocoAppearance.Standard);
  assert.throws(()=>resolveCameraAppearance(new THREE.Scene(),MujocoAppearance.Classic),/managed MuJoCo/);
  assert.throws(()=>resolveCameraAppearance(scene,'wrong' as any),/Camera appearance/);
  let classic:THREE.Material|THREE.Material[]|undefined;
  for(let i=0;i<3;i++) {
   assert.throws(()=>withCameraAppearance(scene,MujocoAppearance.Classic,()=>{
    assert.equal((mesh.material as THREE.Material).type,'ShaderMaterial');
    if(classic)assert.equal(mesh.material,classic);classic=mesh.material;
    withCameraAppearance(scene,MujocoAppearance.Standard,()=>assert.equal(mesh.material,original.material));
    assert.equal(mesh.material,classic);
    throw new Error('render failed');
   }),/render failed/);
   assert.equal(mesh.material,original.material);assert.equal(mesh.geometry,original.geometry);
  }
  assert.equal(f.data.time,time);assert.deepEqual(Array.from(f.data.qpos),qpos);
  let disposed=0;(classic as THREE.Material).addEventListener('dispose',()=>disposed++);
  dispose();dispose();assert.equal(disposed,1);
 }finally{dispose();mesh.geometry.dispose();(mesh.material as THREE.Material).dispose();builder.dispose();f.data.delete();f.native.delete();}
});

test('classic infinite-plane visualization uses the same finite proxy extent as the viewer',()=>{
 const f=fixture(),g=geom(f.native,'floor');f.m.geom_size[g*3]=0;f.m.geom_size[g*3+1]=0;
 const geometry=createClassicPlaneGeometry(f.m,g);geometry.computeBoundingBox();
 try{close(geometry.boundingBox!.min.x,-2.5);close(geometry.boundingBox!.max.y,2.5);}
 finally{geometry.dispose();f.data.delete();f.native.delete();}
});
