// Kompresi GLB dengan Draco (KHR_draco_mesh_compression).
// Mengecilkan geometri 70–90% supaya model IFC besar (>200MB) enteng di web.
// Dipakai oleh scripts/compress-glb.mjs (manual) & scripts/push-model.mjs (auto).
//
// Butuh dependency dev: @gltf-transform/core, @gltf-transform/extensions,
// @gltf-transform/functions, draco3dgltf. Jalankan `npm install` dulu.

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { draco } from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';

// Kompres file GLB di `inputPath`, tulis hasil ke `outputPath`.
// Return { before, after } dalam byte.
export async function compressGlb(inputPath, outputPath, { elements = [] } = {}) {
  const fs = await import('node:fs');
  const path = await import('node:path');
  if (path.resolve(inputPath) === path.resolve(outputPath)) {
    throw new Error('Input dan output harus berbeda; simpan GLB sumber untuk audit.');
  }
  const before = fs.statSync(inputPath).size;

  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    'draco3d.decoder': await draco3d.createDecoderModule(),
    'draco3d.encoder': await draco3d.createEncoderModule(),
  });

  const doc = await io.read(inputPath);
  // Instancing can discard the original element-to-instance mapping. Do not
  // label an entire batch with a mesh/representation ID or pretend to repair it.
  const batches = doc.getRoot().listNodes().filter((n) => n.getExtension('EXT_mesh_gpu_instancing'));
  if (batches.length) {
    throw new Error(`${batches.length} kelompok GPU instancing ditemukan. Konversi ulang dari IFC dengan --use-element-guids, lalu kompres dengan script ini; identitas instance tidak dapat dipulihkan dengan kompresi ulang.`);
  }
  const byGuid = new Map(elements.map((e) => [e.guid, e]));
  const unmatched = [];
  for (const node of doc.getRoot().listNodes()) {
    const row = byGuid.get(node.getName());
    if (row) node.setExtras({ ...node.getExtras(), globalId: row.guid, elementName: row.name, category: row.category });
    else if (elements.length && /^[0-3][0-9A-Za-z_$]{21}$/.test(node.getName())) unmatched.push(node.getName());
  }
  if (unmatched.length) throw new Error(`${unmatched.length} GUID GLB tidak ditemukan di metadata IFC. Pastikan IFC dan GLB berasal dari versi yang sama. Contoh: ${unmatched.slice(0, 3).join(', ')}`);
  const snapshot = (d) => JSON.stringify(d.getRoot().listNodes().map((n) => ({
    name: n.getName(), extras: n.getExtras(), mesh: !!n.getMesh(),
    children: n.listChildren().map((c) => d.getRoot().listNodes().indexOf(c)),
  })));
  const identities = snapshot(doc);
  // Only compress geometry. No join, instance, flatten, simplify or prune.
  await doc.transform(draco());
  const tmp = `${outputPath}.${process.pid}.${Date.now()}.tmp.glb`;
  try {
    await io.write(tmp, doc);
    const check = await io.read(tmp);
    if (snapshot(check) !== identities) throw new Error('Validasi gagal: identitas/hierarki node berubah saat kompresi.');
    fs.renameSync(tmp, outputPath);
  } finally {
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  }

  const after = fs.statSync(outputPath).size;
  return { before, after };
}

export function fmtMB(bytes) {
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}
