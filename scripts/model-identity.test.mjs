import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Document, NodeIO } from '@gltf-transform/core';
import { EXTMeshGPUInstancing } from '@gltf-transform/extensions';
import { compressGlb } from './lib/compress-glb.mjs';
import { resolveModelIdentity } from '../lib/modelIdentity.mjs';

const gid = '3uhIYbu7PDC9vFY0yt1$EN';
test('multi-material primitive uses parent IFC node, not numeric geometry name', () => {
  const root = {}; const parent = { parent: root }; const mesh = { name:'4449_1', parent };
  const parser = { associations:new Map([[parent,{nodes:0}],[mesh,{meshes:0,primitives:1}]]), json:{nodes:[{name:gid,extras:{elementName:'Cable tray',category:'Tray'}}]} };
  assert.deepEqual(resolveModelIdentity(mesh,root,parser),{globalId:gid,name:'Cable tray',category:'Tray'});
});
test('exact source GUID with suffix-like ending is not truncated', () => {
  const object = {}; const exact = '3uhIYbu7PDC9vFY0yt1$_1';
  const parser = {associations:new Map([[object,{nodes:0}]]),json:{nodes:[{name:exact}]}};
  assert.equal(resolveModelIdentity(object,object,parser).globalId,exact);
});
test('anonymous instances and numeric mesh IDs are not assigned fake IFC IDs', () => {
  const root={}; const mesh={name:'4449',parent:root};
  const parser={associations:new Map([[mesh,{meshes:0}]]),json:{nodes:[]}};
  assert.equal(resolveModelIdentity(mesh,root,parser),null);
  mesh.isInstancedMesh=true; mesh.userData={globalId:gid};
  assert.equal(resolveModelIdentity(mesh,root,parser),null);
});
test('shared Three loader association cannot replace the identity of a clone', () => {
  const object={userData:{name:gid,globalId:gid,elementName:'Own name',category:'Tray'}};
  const parser={associations:new Map([[object,{nodes:0}]]),json:{nodes:[{name:'3uhIYbu7PDC9vFY0yt1$C3',extras:{elementName:'Wrong name'}}]}};
  assert.equal(resolveModelIdentity(object,object,parser).globalId,gid);
  assert.equal(resolveModelIdentity(object,object,parser).name,'Own name');
});
test('Draco preserves two independent elements sharing geometry and embedded names', async () => {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'viewer-identity-'));
  try {
    const doc=new Document();const buffer=doc.createBuffer();
    const pos=doc.createAccessor().setType('VEC3').setArray(new Float32Array([0,0,0,1,0,0,0,1,0])).setBuffer(buffer);
    const mesh=doc.createMesh('4449').addPrimitive(doc.createPrimitive().setAttribute('POSITION',pos));
    const scene=doc.createScene();
    for (const id of [gid,'3uhIYbu7PDC9vFY0yt1$C3']) scene.addChild(doc.createNode(id).setMesh(mesh));
    const input=path.join(dir,'in.glb'), output=path.join(dir,'out.glb');
    await new NodeIO().write(input,doc);
    await assert.rejects(compressGlb(input,output,{elements:[{guid:gid,name:'Tray A',category:'Tray'}]}),/tidak ditemukan/);
    await compressGlb(input,output,{elements:[{guid:gid,name:'Tray A',category:'Tray'}, {guid:'3uhIYbu7PDC9vFY0yt1$C3',name:'Tray B',category:'Tray'}]});
    const data=await fs.readFile(output);const json=JSON.parse(data.subarray(20,20+data.readUInt32LE(12)).toString());
    assert.equal(json.nodes.length,2);
    assert.equal(json.nodes.find(n=>n.name===gid).extras.elementName,'Tray A');
    assert.ok(json.extensionsUsed.includes('KHR_draco_mesh_compression'));
    assert.ok(!json.extensionsUsed.includes('EXT_mesh_gpu_instancing'));
    assert.equal(json.accessors.find(a=>a.type==='VEC3').count,3);
    // Input that already lost per-instance identities must fail before output.
    const ext=doc.createExtension(EXTMeshGPUInstancing);
    scene.listChildren()[0].setExtension('EXT_mesh_gpu_instancing',ext.createInstancedMesh().setAttribute('TRANSLATION',pos));
    await new NodeIO().registerExtensions([EXTMeshGPUInstancing]).write(input,doc);
    await assert.rejects(compressGlb(input,path.join(dir,'bad.glb')),/instancing/);
    await assert.rejects(fs.access(path.join(dir,'bad.glb')));
  } finally { await fs.rm(dir,{recursive:true,force:true}); }
});
