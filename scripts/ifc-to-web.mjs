// IFC -> WEB — 1 command untuk siapkan model dari IFC ke file GLB kecil yang
// siap di-upload manual lewat website (halaman Kelola).
//
// Alur:  IFC --(IfcConvert)--> GLB --(Draco)--> GLB kecil siap upload
//                           \--(parse nama family)--> tabel `elements`
//
// Bedanya dengan push-model.mjs: script ini TIDAK meng-upload GLB-nya (file
// tetap di komputermu untuk di-upload manual lewat halaman Kelola / Google
// Drive). Yang dikirim ke Supabase cuma daftar nama & kategori elemen —
// ukurannya kecil, dan tanpa itu viewer tidak bisa tahu nama tiap objek.
//
// KENAPA PERLU: IfcConvert dijalankan dengan --use-element-guids, jadi objek
// di GLB dinamai GlobalId (kode 22 karakter), bukan nama aslinya. Nama &
// kategori hidup di tabel `elements`. Kalau tabel itu kosong, semua elemen
// tampil sebagai kode acak dan masuk kategori "Default".
//
// Pemakaian:
//   node scripts/ifc-to-web.mjs <file.ifc> [project_id] [output.glb]
//
// `project_id` OPSIONAL. Kalau diisi, nama & kategori elemen langsung dikirim
// ke Supabase (tidak perlu paste SQL manual). Kalau dikosongkan, script jalan
// seperti sebelumnya — cuma convert + kompresi.
//
// Kalau output tidak diisi, hasil ditulis ke "<nama-ifc>-web.glb" di folder
// yang sama dengan file IFC-nya.
//
// Konfigurasi (dari .env.local):
//   IFCCONVERT_PATH            - path ke IfcConvert (default: "IfcConvert" di PATH)
//   NEXT_PUBLIC_SUPABASE_URL   - wajib kalau project_id diisi
//   SUPABASE_SERVICE_ROLE_KEY  - wajib kalau project_id diisi (rahasia)
//
// File besar butuh RAM. Kalau kena "heap out of memory", jalankan dengan:
//   node --max-old-space-size=8192 scripts/ifc-to-web.mjs <file.ifc>

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { compressGlb, fmtMB } from './lib/compress-glb.mjs';
import { parseIfcElements, summarize } from './lib/ifc-elements.mjs';
import { upsertElements } from './lib/push-elements.mjs';

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
const [, , ifcPath, ...restArgs] = process.argv;

if (!ifcPath) {
  die('Pemakaian: node scripts/ifc-to-web.mjs <file.ifc> [project_id] [output.glb]');
}
if (!fs.existsSync(ifcPath)) die(`File IFC tidak ditemukan: ${ifcPath}`);

// Argumen sisanya dibedakan dari bentuknya, bukan urutannya — supaya pemakaian
// lama (`ifc-to-web.mjs model.ifc keluaran.glb`) tetap jalan apa adanya.
const isUuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
const projectId = restArgs.find(isUuid) || null;
const outputArg = restArgs.find((a) => !isUuid(a)) || null;

const IFCCONVERT = env.IFCCONVERT_PATH || 'IfcConvert';
const SUPABASE_URL = (env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const outputPath =
  outputArg || path.join(path.dirname(ifcPath), path.basename(ifcPath).replace(/\.ifc$/i, '') + '-web.glb');

// Gagal cepat kalau project_id diisi tapi kredensial belum ada — lebih baik
// tahu sekarang daripada setelah menunggu convert model besar selesai.
if (projectId && (!SUPABASE_URL || !SERVICE_KEY)) {
  die(
    'project_id diisi, tapi NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY\n' +
      '   belum ada di .env.local. Isi dulu, atau jalankan tanpa project_id.'
  );
}

async function main() {
  const steps = projectId ? 3 : 2;
  // Embed metadata even for offline/manual uploads, without a database import.
  const rows = parseIfcElements(fs.readFileSync(ifcPath, 'utf8'));

  // 1) Convert IFC -> GLB (temp)
  console.error(`▶ [1/${steps}] Convert IFC -> GLB (${IFCCONVERT}) ...`);
  const tmpGlb = path.join(os.tmpdir(), `ifc2web-${Date.now()}.glb`);
  try {
    execFileSync(IFCCONVERT, ['-y', '--use-element-guids', ifcPath, tmpGlb], { stdio: 'inherit' });
  } catch (e) {
    die(`IfcConvert gagal. Cek IFCCONVERT_PATH di .env.local atau install IfcConvert. (${e.message})`);
  }
  if (!fs.existsSync(tmpGlb)) die('GLB tidak terbentuk — cek output IfcConvert di atas.');

  // 2) Kompresi Draco -> file akhir
  console.error(`▶ [2/${steps}] Kompresi Draco ...`);
  try {
    const { before, after } = await compressGlb(tmpGlb, outputPath, { elements: rows });
    const pct = Math.round((1 - after / before) * 100);
    console.error(`  ${fmtMB(before)} -> ${fmtMB(after)} (hemat ${pct}%)`);
  } catch (e) {
    fs.unlinkSync(tmpGlb);
    die(`Kompresi gagal: ${e.message}\n   Sudah jalankan "npm install"? (butuh @gltf-transform/*, draco3dgltf)`);
  }

  fs.unlinkSync(tmpGlb);

  // 3) Kirim nama & kategori elemen ke Supabase (kalau project_id diisi).
  if (projectId) {
    console.error(`▶ [3/${steps}] Kirim nama & kategori elemen ke Supabase ...`);
    if (rows.length === 0) {
      console.error('  ⚠ Tidak ada elemen ber-GlobalId terbaca — tabel elements dilewati.');
    } else {
      await upsertElements({
        supabaseUrl: SUPABASE_URL,
        serviceKey: SERVICE_KEY,
        projectId,
        rows,
      });
      const cats = summarize(rows);
      console.error(`  ${rows.length} elemen, ${cats.length} kategori tersimpan.`);
      cats.slice(0, 8).forEach(([c, n]) => console.error(`    ${n}\t${c}`));
      if (cats.length > 8) console.error(`    … dan ${cats.length - 8} kategori lain`);
    }
  }

  console.error(`\n✅ Selesai: ${outputPath}`);
  console.error('   Upload file ini di halaman Kelola (Upload model GLB).');
  if (!projectId) {
    console.error(
      '\n   Nama & kategori tersimpan di extras node GLB untuk viewer yang mendukungnya.\n' +
        '   Sinkronisasi database opsional: node scripts/ifc-to-web.mjs <file.ifc> <project_id>'
    );
  }
  console.error('');
}

main().catch((e) => die(e.message));
