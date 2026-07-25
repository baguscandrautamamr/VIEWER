// IFC -> WEB — 1 command untuk siapkan model dari IFC ke file GLB kecil yang
// siap di-upload manual lewat website (halaman Kelola).
//
// Alur:  IFC --(IfcConvert)--> GLB --(Draco)--> GLB kecil siap upload
//
// Bedanya dengan push-model.mjs: script ini TIDAK upload ke Supabase. Cuma
// menghasilkan file GLB terkompresi di komputermu, lalu kamu upload sendiri
// di halaman Kelola (Upload model GLB). Cocok untuk alur manual + Google Drive.
//
// Pemakaian:
//   node scripts/ifc-to-web.mjs <file.ifc> [output.glb]
//
// Kalau output tidak diisi, hasil ditulis ke "<nama-ifc>-web.glb" di folder
// yang sama dengan file IFC-nya.
//
// Konfigurasi (dari .env.local, opsional):
//   IFCCONVERT_PATH  - path ke IfcConvert (default: "IfcConvert" di PATH)
//
// File besar butuh RAM. Kalau kena "heap out of memory", jalankan dengan:
//   node --max-old-space-size=8192 scripts/ifc-to-web.mjs <file.ifc>

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { compressGlb, fmtMB } from './lib/compress-glb.mjs';

function loadEnvLocal() {
  const env = { ...process.env };
  const p = path.join(process.cwd(), '.env.local');
  if (fs.existsSync(p)) {
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (!m) continue;
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      if (env[m[1]] === undefined || env[m[1]] === '') env[m[1]] = v;
    }
  }
  return env;
}

function die(msg) {
  console.error('\n❌ ' + msg + '\n');
  process.exit(1);
}

const env = loadEnvLocal();
const [, , ifcPath, outputArg] = process.argv;

if (!ifcPath) {
  die('Pemakaian: node scripts/ifc-to-web.mjs <file.ifc> [output.glb]');
}
if (!fs.existsSync(ifcPath)) die(`File IFC tidak ditemukan: ${ifcPath}`);

const IFCCONVERT = env.IFCCONVERT_PATH || 'IfcConvert';
const outputPath =
  outputArg || path.join(path.dirname(ifcPath), path.basename(ifcPath).replace(/\.ifc$/i, '') + '-web.glb');

async function main() {
  // 1) Convert IFC -> GLB (temp)
  console.error(`▶ [1/2] Convert IFC -> GLB (${IFCCONVERT}) ...`);
  const tmpGlb = path.join(os.tmpdir(), `ifc2web-${Date.now()}.glb`);
  try {
    execFileSync(IFCCONVERT, ['-y', '--use-element-guids', ifcPath, tmpGlb], { stdio: 'inherit' });
  } catch (e) {
    die(`IfcConvert gagal. Cek IFCCONVERT_PATH di .env.local atau install IfcConvert. (${e.message})`);
  }
  if (!fs.existsSync(tmpGlb)) die('GLB tidak terbentuk — cek output IfcConvert di atas.');

  // 2) Kompresi Draco -> file akhir
  console.error('▶ [2/2] Kompresi Draco ...');
  try {
    const { before, after } = await compressGlb(tmpGlb, outputPath);
    const pct = Math.round((1 - after / before) * 100);
    console.error(`  ${fmtMB(before)} -> ${fmtMB(after)} (hemat ${pct}%)`);
  } catch (e) {
    fs.unlinkSync(tmpGlb);
    die(`Kompresi gagal: ${e.message}\n   Sudah jalankan "npm install"? (butuh @gltf-transform/*, draco3dgltf)`);
  }

  fs.unlinkSync(tmpGlb);

  console.error(`\n✅ Selesai: ${outputPath}`);
  console.error('   Upload file ini di halaman Kelola (Upload model GLB).\n');
}

main().catch((e) => die(e.message));
