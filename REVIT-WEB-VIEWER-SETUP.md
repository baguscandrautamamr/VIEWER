---
title: Revit Web Viewer — Setup & Architecture Spec
status: skeleton generated, build in progress
last_updated: 2026-07-24
---

# Revit Web Viewer — Spec Teknis

Website presentasi client yang sync dari Revit: 3D view (isolate-on-click),
sheet PDF, auto-update saat model di-push, dan link download file RVT mentah.

## 1. Tujuan

1. Sheet & 3D view dari Revit bisa disajikan ke client lewat browser, tanpa
   client perlu buka Revit atau install viewer berat.
2. 3D viewer punya fitur isolate: klik satu object electrical, object lain
   jadi redup (dim), supaya presentasi lebih fokus.
3. Saat model di-push ulang dari Revit, website auto-update — element yang
   berubah langsung terlihat tanpa refresh manual.
4. File Revit (.rvt) asli tetap bisa diakses/download dari website yang sama.

## 2. Prinsip arsitektur

- **Open-source pipeline, no Autodesk API dependency** — jalur APS (Autodesk
  Platform Services) sudah dievaluasi dan ditinggalkan karena butuh
  berbayar. Jalur yang dipakai: IFC export (built-in Revit) → IfcConvert
  (IfcOpenShell, gratis) → glTF/GLB → render pakai Three.js di browser.
- **Split penyimpanan berdasarkan ukuran & fungsi, bukan satu database untuk
  semua:**
  - Supabase (Postgres + Storage + Realtime) → metadata, versi, delta
    element yang berubah, file GLB & PDF (relatif kecil, perlu diakses cepat
    dari browser)
  - Google Drive → file .rvt mentah (bisa ratusan MB–1GB+, gratis untuk
    ukuran segitu, cuma dipakai untuk archive/download — bukan dibaca
    langsung oleh browser)
- **localStorage tidak relevan di sini** — ini bukan field-ops app, data
  utamanya memang harus live dari server (Supabase) karena tujuannya
  presentasi real-time ke client, bukan kerja offline.
- **Akses client via token/PIN, bukan akun login penuh** — client biasanya
  sekali pakai per project, tidak mau daftar akun.

## 3. Alur kerja (flow)

1. User (drafter) pilih 3D view yang sudah di-isolate ke disiplin electrical
   saja di Revit, lalu klik tombol **Export & Push** di ribbon add-in.
2. Add-in export IFC dari view terpilih.
3. Add-in panggil IfcConvert (lokal, dijalankan sebagai subprocess) untuk
   convert IFC → GLB.
4. Add-in bandingkan GlobalId + parameter kunci elemen terhadap snapshot
   push sebelumnya → hasilkan **delta list** (element yang berubah).
5. Add-in upload:
   - GLB baru → Supabase Storage
   - Sheet PDF (kalau ada perubahan) → Supabase Storage
   - File .rvt (opsional, tidak perlu tiap push) → Google Drive
6. Add-in insert row baru ke tabel `model_versions` di Supabase (path GLB,
   delta list, timestamp).
7. Supabase Realtime broadcast perubahan tabel itu ke semua client yang
   sedang membuka halaman `/present/[projectId]`.
8. Browser client fetch GLB terbaru, reload scene, dan highlight sementara
   (2-3 detik) element yang ada di delta list.

## 4. Skema database (Supabase / Postgres)

```sql
create table projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  client_access_token text unique not null,
  created_at timestamptz default now()
);

create table model_versions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  version_number int not null,
  glb_storage_path text not null,
  rvt_drive_file_id text,
  changed_global_ids text[] default '{}',
  pushed_at timestamptz default now(),
  pushed_by text
);

create table sheets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  version_id uuid references model_versions(id) on delete cascade,
  sheet_number text not null,
  sheet_name text,
  pdf_storage_path text not null
);

create table elements (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  global_id text not null,
  category text,
  name text,
  parameters jsonb default '{}',
  last_updated_version_id uuid references model_versions(id),
  unique (project_id, global_id)
);
```

Row Level Security: aktifkan RLS, policy read-only untuk role `anon` yang
filter berdasarkan `client_access_token` yang cocok — jangan expose semua
project ke semua orang yang punya anon key.

## 5. Struktur website (Next.js App Router, deploy Vercel)

Lihat folder skeleton di repo ini. Ringkasan tanggung jawab tiap bagian:

- `app/present/[projectId]/` — halaman client-facing. Akses via token di
  query string atau PIN input. Isi: 3D viewer, sheet viewer, tombol
  download RVT, indikator versi terbaru (live via Realtime).
- `app/admin/[projectId]/` — halaman internal. Lihat history push, generate
  token akses baru untuk client, kelola project.
- `app/api/push/route.ts` — endpoint yang dipanggil add-in setiap push.
  Terima payload (glb path, delta list, sheet list), insert ke Supabase.
- `components/ModelViewer.tsx` — Three.js scene, raycasting untuk
  isolate-on-click, subscribe Supabase Realtime untuk auto-reload.
- `components/SheetViewer.tsx` — render PDF pakai pdf.js.
- `lib/googleDrive.ts` — helper ambil/upload file lewat Google Drive API
  (service account, bukan OAuth user, supaya add-in bisa upload otomatis).

## 6. Isolate-on-click — detail implementasi

- Tiap mesh di scene di-tag `userData.globalId` saat parsing GLB (GlobalId
  disimpan sebagai custom property di IFC → ikut terbawa ke glTF extras).
- Klik (raycaster) → dapat mesh target → set material semua mesh lain:
  `opacity: 0.12, transparent: true, depthWrite: false`. Mesh target tetap
  full opacity + outline (misal pakai `THREE.EdgesGeometry` warna aksen).
- Klik area kosong / tombol "Reset View" → kembalikan semua mesh ke state
  normal.
- Klik mesh juga trigger fetch parameter dari tabel `elements` (by
  `global_id`) → tampil di side panel (voltage, load, circuit, dll) — ini
  yang bikin viewer berguna buat presentasi teknis, bukan cuma visual.

## 7. Auto-update — detail implementasi

```ts
// lib/realtime.ts (ringkasan alur, bukan kode final)
supabase
  .channel(`project-${projectId}`)
  .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'model_versions',
        filter: `project_id=eq.${projectId}` },
      (payload) => {
        // fetch GLB baru dari payload.new.glb_storage_path
        // reload scene, highlight payload.new.changed_global_ids
      })
  .subscribe();
```

## 8. Rencana fase (rekomendasi urutan build)

- **Fase 1 — Viewer statis**: export manual sekali, upload manual ke
  Supabase Storage, website tampilkan 3D + isolate-on-click + sheet PDF.
  Tidak ada push otomatis dulu. Tujuan: validasi kualitas hasil convert
  IFC→glTF dan UX isolate sebelum invest ke realtime sync.
- **Fase 2 — Push dari add-in + versioning**: tombol Export & Push di
  ribbon, endpoint `/api/push`, tabel `model_versions` aktif, Realtime
  auto-update nyala.
- **Fase 3 — Delta highlight + RVT ke Google Drive**: fitur highlight
  element yang berubah, tombol download RVT. Nice-to-have, bukan blocker
  untuk demo pertama ke client.

## 9. Environment variables

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=       # server-side only, jangan expose ke client
GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON=
GOOGLE_DRIVE_FOLDER_ID=
```

Ikuti konvensi: `.env.local` untuk dev, `.env.example` untuk dokumentasi
(tanpa value asli), `.gitignore` sudah include `.env*` sebelum commit
pertama. Isi env var production lewat dashboard Vercel, bukan file yang
ke-commit.

## 10. Batasan & catatan performa

- Jangan export whole model — selalu export dari 3D view yang sudah
  di-isolate ke disiplin electrical di Revit dulu, supaya GLB tidak
  kebesaran untuk browser/mobile client.
- Draco compression di tahap convert (opsi IfcConvert / post-process glTF)
  kalau ukuran file masih terasa berat.
- Full re-export tiap push cukup untuk ukuran project kantoran biasa. Kalau
  model makin besar, pertimbangkan export per-view/per-sistem, bukan
  per-model penuh.
- Mulai dari satu project kecil dulu untuk uji pipeline end-to-end, sebelum
  dipakai di project besar (contoh: warehouse series).

## 11. Belum diputuskan / perlu dikonfirmasi saat build

- Format token akses client: query string (`?t=xxxx`) vs PIN input di
  halaman terpisah — pilih salah satu sebelum mulai Fase 1.
- Apakah IfcConvert dijalankan manual (Fase 1) atau langsung disubprocess
  dari add-in (Fase 2) — disarankan manual dulu untuk Fase 1.
- Retention policy versi lama di Supabase Storage — apakah semua versi
  disimpan atau cuma N versi terakhir (supaya storage free tier tidak
  penuh).
