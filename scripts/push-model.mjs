// PUSH MODEL — 1 command untuk update model dari IFC ke website.
//
// Alur otomatis:
//   IFC --(IfcConvert)--> GLB --> upload ke Supabase Storage
//        --(parse family)--> kategori --> tabel elements
//        --> baris baru di model_versions (versi naik, viewer auto-reload)
//
// Cuma butuh Node 18+ (pakai fetch bawaan) — TIDAK perlu `npm install`.
//
// Pemakaian:
//   node scripts/push-model.mjs <file.ifc> <project_id> [pushed_by]
//
// Konfigurasi diambil dari .env.local di folder ini (lihat .env.local.example):
//   NEXT_PUBLIC_SUPABASE_URL   - url project Supabase
//   SUPABASE_SERVICE_ROLE_KEY  - service role key (server-side, rahasia)
//   IFCCONVERT_PATH            - path ke IfcConvert.exe (mis. C:\ifcconvert\IfcConvert.exe)
//   SUPABASE_BUCKET            - opsional, default "models"

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseIfcElements, summarize } from './lib/ifc-elements.mjs';

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
const [, , ifcPath, projectId, pushedByArg] = process.argv;

if (!ifcPath || !projectId) {
  die('Pemakaian: node scripts/push-model.mjs <file.ifc> <project_id> [pushed_by]');
}
if (!fs.existsSync(ifcPath)) die(`File IFC tidak ditemukan: ${ifcPath}`);

const SUPABASE_URL = (env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = env.SUPABASE_BUCKET || 'models';
const IFCCONVERT = env.IFCCONVERT_PATH || 'IfcConvert';
const PUSHED_BY = pushedByArg || env.PUSHED_BY || 'push-script';

if (!SUPABASE_URL) die('NEXT_PUBLIC_SUPABASE_URL belum diisi di .env.local');
if (!SERVICE_KEY) die('SUPABASE_SERVICE_ROLE_KEY belum diisi di .env.local');

const authHeaders = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };

async function rest(pathAndQuery, init = {}) {
  const res = await fetch(`${SUPABASE_URL}${pathAndQuery}`, {
    ...init,
    headers: { ...authHeaders, ...(init.headers || {}) },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${init.method || 'GET'} ${pathAndQuery} -> ${res.status}\n${body}`);
  }
  return res;
}

async function main() {
  // 1) Convert IFC -> GLB (temp file)
  console.error(`▶ Convert IFC -> GLB (${IFCCONVERT}) ...`);
  const tmpGlb = path.join(os.tmpdir(), `push-${Date.now()}.glb`);
  try {
    execFileSync(IFCCONVERT, ['-y', '--use-element-guids', ifcPath, tmpGlb], { stdio: 'inherit' });
  } catch (e) {
    die(`IfcConvert gagal. Cek IFCCONVERT_PATH di .env.local. (${e.message})`);
  }
  if (!fs.existsSync(tmpGlb)) die('GLB tidak terbentuk — cek output IfcConvert di atas.');

  // 2) Parse kategori dari IFC
  const rows = parseIfcElements(fs.readFileSync(ifcPath, 'utf8'));
  console.error(`▶ ${rows.length} elemen, ${summarize(rows).length} kategori terbaca.`);

  // 3) Nomor versi berikutnya
  const vRes = await rest(
    `/rest/v1/model_versions?project_id=eq.${projectId}&select=version_number&order=version_number.desc&limit=1`
  );
  const nextVersion = ((await vRes.json())[0]?.version_number ?? 0) + 1;

  // 4) Upload GLB ke Storage (path unik per versi -> versi lama tetap ada)
  const storagePath = `${projectId}/v${nextVersion}-${Date.now()}.glb`;
  console.error(`▶ Upload GLB -> ${BUCKET}/${storagePath} ...`);
  const upRes = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${storagePath}`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'model/gltf-binary', 'x-upsert': 'true' },
    body: fs.readFileSync(tmpGlb),
  });
  if (!upRes.ok) die(`Upload GLB gagal: ${upRes.status}\n${await upRes.text()}`);
  const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${storagePath}`;

  // 5) Insert baris model_versions (memicu Realtime -> viewer auto-reload)
  const mvRes = await rest(`/rest/v1/model_versions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({
      project_id: projectId,
      version_number: nextVersion,
      glb_storage_path: publicUrl,
      pushed_by: PUSHED_BY,
    }),
  });
  const versionId = (await mvRes.json())[0]?.id;

  // 6) Upsert elements (kategori per objek) secara chunk
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const body = rows.slice(i, i + CHUNK).map((r) => ({
      project_id: projectId,
      global_id: r.guid,
      category: r.category,
      name: r.name,
      last_updated_version_id: versionId,
    }));
    await rest(`/rest/v1/elements?on_conflict=project_id,global_id`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(body),
    });
  }

  // 7) Ambil token buat cetak link presentasi
  let presentHint = `/present/${projectId}?t=<token>`;
  try {
    const pRes = await rest(`/rest/v1/projects?id=eq.${projectId}&select=client_access_token`);
    const token = (await pRes.json())[0]?.client_access_token;
    if (token) presentHint = `/present/${projectId}?t=${token}`;
  } catch {
    /* token opsional untuk output */
  }

  fs.unlinkSync(tmpGlb);

  console.error(`\n✅ Push sukses — versi v${nextVersion}.`);
  console.error(`   Link presentasi (tambahkan domain kamu): ${presentHint}`);
  console.error(`   Viewer yang lagi kebuka akan auto-reload lewat Realtime.\n`);
}

main().catch((e) => die(e.message));
