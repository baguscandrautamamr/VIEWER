// Kompresi GLB dengan Draco (KHR_draco_mesh_compression).
// Mengecilkan geometri 70–90% supaya model IFC besar (>200MB) enteng di web.
// Dipakai oleh scripts/compress-glb.mjs (manual) & scripts/push-model.mjs (auto).
//
// Butuh dependency dev: @gltf-transform/core, @gltf-transform/extensions,
// @gltf-transform/functions, draco3dgltf. Jalankan `npm install` dulu.

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, draco, prune, weld } from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';

// Kompres file GLB di `inputPath`, tulis hasil ke `outputPath`.
// Return { before, after } dalam byte.
export async function compressGlb(inputPath, outputPath) {
  const fs = await import('node:fs');
  const before = fs.statSync(inputPath).size;

  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    'draco3d.decoder': await draco3d.createDecoderModule(),
    'draco3d.encoder': await draco3d.createEncoderModule(),
  });

  const doc = await io.read(inputPath);
  // dedup+prune: buang data duplikat/tak terpakai. weld: satukan vertex kembar
  // (syarat Draco). draco: kompresi geometri utama.
  await doc.transform(dedup(), prune(), weld(), draco());
  await io.write(outputPath, doc);

  const after = fs.statSync(outputPath).size;
  return { before, after };
}

export function fmtMB(bytes) {
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}
