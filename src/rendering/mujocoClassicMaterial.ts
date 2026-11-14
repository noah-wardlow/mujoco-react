/** @license SPDX-License-Identifier: Apache-2.0 */
import * as THREE from 'three';
import type { MujocoData, MujocoModel } from '../types';

const MAX_LIGHTS = 8;
const vertexShader = `
  uniform vec4 diffuse;
  uniform float emission, specular, shininess;
  uniform int lightCount;
  uniform float lightMode[8];
  uniform vec3 lightPos[8], lightDir[8], lightAmbient[8], lightDiffuse[8], lightSpecular[8], lightAttenuation[8];
  uniform float lightCutoff[8], lightExponent[8];
  uniform bool explicitUV;
  uniform vec2 repeatScale;
  uniform vec3 cubeScale;
  varying vec3 cubeCoord;
  varying vec4 litColor;
  varying vec2 texCoord;
  void main() {
    vec4 p = modelViewMatrix * vec4(position, 1.0);
    vec3 n = normalize(normalMatrix * normal);
    vec3 v = normalize(-p.xyz);
    vec3 rgb = diffuse.rgb * emission;
    if (lightCount == 0) rgb += diffuse.rgb * 0.3;
    for (int i=0; i<8; i++) {
      if (i>=lightCount) break;
      vec3 l;
      float attenuation = 1.0;
      if (lightMode[i] > 1.5) l = vec3(0.0, 0.0, 1.0);
      else if (lightMode[i] > 0.5) l = normalize(-(viewMatrix * vec4(lightDir[i],0.0)).xyz);
      else {
        vec3 delta = (viewMatrix * vec4(lightPos[i],1.0)).xyz - p.xyz;
        float distance = length(delta);
        l = normalize(delta);
        vec3 a = lightAttenuation[i];
        attenuation = 1.0 / max(1e-8, a.x+a.y*distance+a.z*distance*distance);
        vec3 direction = normalize((viewMatrix * vec4(lightDir[i],0.0)).xyz);
        float spot = dot(-l,direction);
        if(lightCutoff[i] >= -1.0) attenuation *= spot >= lightCutoff[i] ? (lightExponent[i] > 0.0 ? pow(max(0.0,spot),lightExponent[i]) : 1.0) : 0.0;
      }
      float lambert = max(0.0,dot(n,l));
      vec3 h = normalize(l+v);
      float shine = lambert > 0.0 && specular > 0.0 ? (shininess > 0.0 ? pow(max(0.0,dot(n,h)),shininess) : 1.0) : 0.0;
      rgb += attenuation*(diffuse.rgb*(lightAmbient[i]+lambert*lightDiffuse[i])+specular*shine*lightSpecular[i]);
    }
    litColor = vec4(clamp(rgb,0.0,1.0),diffuse.a);
    cubeCoord = position*cubeScale;
    texCoord = explicitUV ? vec2(uv.x,1.0-uv.y) : vec2(.5*repeatScale.x*position.x-.5,-.5*repeatScale.y*position.y-.5);
    gl_Position = projectionMatrix*p;
  }`;
const fragmentShader = `
  uniform bool useMap;
  uniform sampler2D colorMap;
  uniform bool useCube;
  uniform samplerCube cubeMap;
  varying vec3 cubeCoord;
  varying vec4 litColor;
  varying vec2 texCoord;
  void main() {
    gl_FragColor = litColor * (useMap ? texture2D(colorMap,texCoord) : (useCube ? textureCube(cubeMap,cubeCoord) : vec4(1.0)));
  }`;

interface ClassicVisualModel {
  vis: { headlight: { active: number; ambient: Float32Array; diffuse: Float32Array; specular: Float32Array } };
  tex_type: Int32Array;
  tex_colorspace: Int32Array;
  mat_emission: Float32Array;
  mat_specular: Float32Array;
  mat_shininess: Float32Array;
  light_ambient: Float32Array;
}
interface ClassicLightData { light_xpos: Float64Array; light_xdir: Float64Array }

const textureCache = new WeakMap<MujocoModel, Map<number, { texture: THREE.Texture; references: number }>>();
function acquireTexture(model: MujocoModel, id: number) {
  const m = model as MujocoModel & ClassicVisualModel;
  let cache = textureCache.get(model);
  if (!cache) { cache = new Map(); textureCache.set(model, cache); }
  let entry = cache.get(id);
  if (!entry) {
    const width = model.tex_width[id], height = model.tex_height[id], channels = model.tex_nchannel[id];
    if (channels !== 3 && channels !== 4) throw new Error('Classic RGB textures require three or four channels');
    const bytes = model.tex_data.subarray(model.tex_adr[id],model.tex_adr[id]+width*height*channels);
    const rgba = new Uint8Array(width*height*4);
    for(let i=0;i<width*height;i++) {
      rgba.set(bytes.subarray(i*channels,i*channels+3),i*4);
      rgba[i*4+3] = channels === 4 ? bytes[i*channels+3] : 255;
    }
    let texture: THREE.Texture;
    if(m.tex_type[id] === 0) {
      texture = new THREE.DataTexture(rgba,width,height,THREE.RGBAFormat);
      texture.colorSpace = m.tex_colorspace[id] === 2 ? THREE.SRGBColorSpace : THREE.LinearSRGBColorSpace;
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.magFilter = THREE.LinearFilter;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.generateMipmaps = true;
    } else if(m.tex_type[id] === 1) {
      if(height !== 6*width) throw new Error('Classic cube texture must contain six square faces');
      const faces = Array.from({length:6},(_,i)=>new THREE.DataTexture(rgba.subarray(i*width*width*4,(i+1)*width*width*4),width,width,THREE.RGBAFormat));
      // WebGLTextures supports DataTexture cube faces; older @types/three
      // narrows this constructor to DOM images only.
      texture = new THREE.CubeTexture(faces as unknown as HTMLImageElement[]);
      // MuJoCo's classic cube upload uses a linear RGB internal format.
      texture.colorSpace = THREE.LinearSRGBColorSpace;
    } else throw new Error('Classic materials require a 2D or cube RGB texture');
    texture.flipY=false; texture.needsUpdate=true;
    entry={texture,references:0}; cache.set(id,entry);
  }
  entry.references++;
  const retained=entry;
  return { texture:entry.texture, release() {
    if(--retained.references===0) { retained.texture.dispose(); cache!.delete(id); }
  }};
}

/** Finite planes use the same grid spacing as MuJoCo's classic display lists. */
export function createClassicPlaneGeometry(model: MujocoModel, geom: number) {
  const size = model.geom_size.subarray(geom*3,geom*3+3);
  if(size[0]<=0 || size[1]<=0) throw new Error('Classic appearance currently requires finite plane extents');
  const axis = (half:number) => {
    const step=Math.max(size[2],half/98);
    let count=Math.floor(half/step); count-=count%2;
    const pad=half-count*step; count+=2;
    const grid:number[]=[];
    for(let i=0;i<count;i++) {
      const left=i===0 ? -half : -half+pad+(i-1)*2*step;
      const right=left+(i===0 || i===count-1 ? pad : 2*step);
      grid[i]=left;grid[i+1]=Math.max(left,right);
    }
    return grid;
  };
  const x=axis(size[0]),y=axis(size[1]),positions:number[]=[],normals:number[]=[],indices:number[]=[];
  for(const py of y)for(const px of x){positions.push(px,py,0);normals.push(0,0,1);}
  for(let row=0;row<y.length-1;row++)for(let col=0;col<x.length-1;col++) {
    const a=row*x.length+col,b=a+1,c=a+x.length,d=c+1;
    indices.push(a,b,d,a,d,c);
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));
  geometry.setIndex(indices);return geometry;
}

/** Opt-in classic-OpenGL equations. Produces native display-code RGB values;
 * request linear RGB-D readback for comparisons. Shadows and planar
 * reflections are outside this material adapter's scope. */
export function createMujocoClassicMaterial(model: MujocoModel, data: MujocoData,
  geom: number): THREE.ShaderMaterial {
  const m = model as MujocoModel & ClassicVisualModel, d = data as MujocoData & ClassicLightData;
  for (const name of ['tex_type','tex_colorspace','mat_emission','mat_specular','mat_shininess','light_ambient'] as const) {
    if(!m[name] || typeof m[name].length !== 'number') throw new Error(`Classic appearance requires model.${name}`);
  }
  if(!m.vis?.headlight || !d.light_xpos || !d.light_xdir) throw new Error('Classic appearance requires MuJoCo visual/light state');
  const mat = model.geom_matid[geom], rgba = Array.from(model.geom_rgba.slice(4*geom,4*geom+4));
  if (mat >= 0 && rgba.every((v,i)=>v === [0.5,0.5,0.5,1][i])) rgba.splice(0,4,...model.mat_rgba.slice(4*mat,4*mat+4));
  const roles = model.mat_texid.length / Math.max(1,model.mat_rgba.length/4);
  const textureId = mat >= 0 ? model.mat_texid[mat*roles+1] : -1;
  const retained = textureId >= 0 ? acquireTexture(model,textureId) : undefined;
  const texture = retained?.texture ?? null;
  const vectors = () => Array.from({length:MAX_LIGHTS},()=>new THREE.Vector3());
  const uniforms = {
    diffuse:{value:new THREE.Vector4(...rgba as [number,number,number,number])},
    emission:{value:mat>=0?m.mat_emission[mat]:0}, specular:{value:mat>=0?m.mat_specular[mat]:.5},
    shininess:{value:128*(mat>=0?m.mat_shininess[mat]:.5)},
    lightCount:{value:0},lightMode:{value:new Float32Array(MAX_LIGHTS)},
    lightPos:{value:vectors()},lightDir:{value:vectors()},lightAmbient:{value:vectors()},lightDiffuse:{value:vectors()},lightSpecular:{value:vectors()},lightAttenuation:{value:vectors()},
    lightCutoff:{value:new Float32Array(MAX_LIGHTS)},lightExponent:{value:new Float32Array(MAX_LIGHTS)},
    explicitUV:{value:Number(model.geom_type[geom])===7 && (model.mesh_texcoordadr?.[model.geom_dataid[geom]]??-1)>=0},
    repeatScale:{value:new THREE.Vector2(mat>=0?model.mat_texrepeat[mat*2]:1,mat>=0?model.mat_texrepeat[mat*2+1]:1)},
    useMap:{value:!!texture && m.tex_type[textureId]===0},colorMap:{value:texture && m.tex_type[textureId]===0 ? texture : null},
    useCube:{value:!!texture && m.tex_type[textureId]===1},cubeMap:{value:texture && m.tex_type[textureId]===1 ? texture : null},
    cubeScale:{value:new THREE.Vector3(1,1,1)},
  };
  if(mat>=0 && !model.mat_texuniform[mat]) {
    const size=model.geom_size;
    uniforms.repeatScale.value.x/=size[geom*3]||1;uniforms.repeatScale.value.y/=size[geom*3+1]||1;
  }
  const isMeshOrPlane=Number(model.geom_type[geom])===7 || Number(model.geom_type[geom])===0;
  const uniform=mat>=0 && model.mat_texuniform[mat];
  for(let i=0;i<3;i++) uniforms.cubeScale.value.setComponent(i,isMeshOrPlane ? (uniform ? model.geom_size[geom*3+i] : 1) : (uniform ? 1 : 1/(model.geom_size[geom*3+i]||1)));
  const material=new THREE.ShaderMaterial({uniforms,vertexShader,fragmentShader,toneMapped:false,side:THREE.DoubleSide,transparent:rgba[3]<1,depthWrite:rgba[3]>=1});
  const head=m.vis.headlight;
  material.onBeforeRender=()=>{
    let count=0;
    const add=(mode:number,pos:ArrayLike<number>,dir:ArrayLike<number>,ambient:ArrayLike<number>,diffuse:ArrayLike<number>,specular:ArrayLike<number>,attenuation:ArrayLike<number>,cutoff:number,exponent:number)=>{
      if(count>=MAX_LIGHTS)throw new Error('Classic appearance supports at most eight lights');
      uniforms.lightMode.value[count]=mode;
      for(const [uniform,value] of [[uniforms.lightPos,pos],[uniforms.lightDir,dir],[uniforms.lightAmbient,ambient],[uniforms.lightDiffuse,diffuse],[uniforms.lightSpecular,specular],[uniforms.lightAttenuation,attenuation]] as const)uniform.value[count].fromArray(value);
      uniforms.lightCutoff.value[count]=cutoff >= 180 ? -2 : Math.cos(cutoff*Math.PI/180);uniforms.lightExponent.value[count]=exponent;count++;
    };
    if(head.active)add(2,[0,0,0],[0,0,-1],head.ambient,head.diffuse,head.specular,[1,0,0],180,0);
    for(let i=0;i<model.nlight;i++)if(m.light_active[i]){
      const type=m.light_type[i];
      if(type!==0&&type!==1)throw new Error('Classic appearance requires spot or directional MJCF lights');
      const slice=(a:ArrayLike<number>)=>[a[i*3],a[i*3+1],a[i*3+2]];
      add(type,slice(d.light_xpos),slice(d.light_xdir),slice(m.light_ambient),slice(m.light_diffuse),slice(m.light_specular),slice(m.light_attenuation),m.light_cutoff[i],m.light_exponent[i]);
    }
    uniforms.lightCount.value=count;material.uniformsNeedUpdate=true;
  };
  let released=false;
  material.addEventListener('dispose',()=>{if(!released){retained?.release();released=true;}});
  return material;
}
