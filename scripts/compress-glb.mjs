// COMPRESS GLB — kecilkan file GLB dengan Draco sebelum di-upload manual
// lewat website (halaman Kelola). Cocok untuk model IFC besar (>200MB) yang
// sudah kamu convert sendiri ke GLB (mis. lewat IfcConvert / Blender / online).
//
// Alur manual jadi:  IFC -> GLB -> (script ini) -> GLB kecil -> upload di web
//
// Pemakaian:
//   node scripts/compress-glb.mjs <input.glb> [output.glb]
//
// Kalau output tidak diisi, hasil ditulis ke "<input>-draco.glb".
// File besar butuh RAM; kalau kena "heap out of memory", jalankan dengan:
//   node --max-old-space-size=8192 scripts/compress-glb.mjs <input.glb>

import fs from 'node:fs';
import path from 'node:path';
import { compressGlb, fmtMB } from './lib/compress-glb.mjs';

const [, , inputPath, outputArg] = process.argv;

if (!inputPath) {
  console.error('\nPemakaian: node scripts/compress-glb.mjs <input.glb> [output.glb]\n');
  process.exit(1);
}
if (!fs.existsSync(inputPath)) {
  console.error(`\n❌ File tidak ditemukan: ${inputPath}\n`);
  process.exit(1);
}

const outputPath =
  outputArg || path.join(path.dirname(inputPath), path.basename(inputPath, '.glb') + '-draco.glb');

console.error(`▶ Kompresi Draco: ${inputPath} ...`);
try {
  const { before, after } = await compressGlb(inputPath, outputPath);
  const pct = Math.round((1 - after / before) * 100);
  console.error(`\n✅ Selesai: ${outputPath}`);
  console.error(`   ${fmtMB(before)} -> ${fmtMB(after)} (hemat ${pct}%)\n`);
} catch (e) {
  console.error(`\n❌ Gagal kompresi: ${e.message}\n`);
  process.exit(1);
}
