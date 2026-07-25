# Revit Web Viewer

Website presentasi client: 3D view dari Revit (isolate-on-click), sheet PDF,
auto-update saat model di-push, download file RVT.

Spec lengkap: lihat `REVIT-WEB-VIEWER-SETUP.md`.

## Status

Fase 1 (viewer statis) — struktur sudah jalan & `next build` hijau:

- Akses client: **token via query string** (`/present/[projectId]?t=<token>`).
  Ini keputusan Fase 1 untuk item "belum diputuskan" di spec bagian 11
  (alternatif PIN input bisa dipasang belakangan di `app/api/auth`).
- Halaman `/present/[projectId]` sudah validasi token ke
  `projects.client_access_token` sebelum render (server-side, pakai service
  role — anon key tidak pernah dipakai untuk gate ini).
- RLS + publication Realtime sudah ditulis di `supabase/schema.sql`
  (`model_versions` masuk `supabase_realtime` supaya auto-update jalan).
- Client Supabase anon dibuat lazy (lihat `lib/supabase.ts`) supaya build &
  server route tidak butuh env di build time.

Belum dites end-to-end dengan GLB/PDF asli & instance Supabase betulan —
itu langkah berikutnya di Fase 1 (lihat spec bagian 8).

## Env vars yang dibutuhkan

| Variable | Keterangan |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | URL project Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Anon key, aman diekspos ke client (dibatasi RLS) |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side only, jangan pernah expose ke client |
| `GOOGLE_OAUTH_CLIENT_ID` | OAuth client id (Google Drive, file .rvt) |
| `GOOGLE_OAUTH_CLIENT_SECRET` | OAuth client secret |
| `GOOGLE_OAUTH_REFRESH_TOKEN` | Refresh token, diambil sekali via `scripts/get-refresh-token.mjs` |
| `GOOGLE_DRIVE_FOLDER_ID` | Folder tujuan upload file RVT |

Copy `.env.local.example` ke `.env.local` dan isi value asli sebelum `npm run dev`.

Google Drive pakai **OAuth user** (bukan service account) supaya file `.rvt`
masuk kuota 15GB akun kamu — gratis, tidak kena limit kuota service account.
Cara dapat semua env Google + kenapa OAuth: lihat
**[`docs/GOOGLE-DRIVE-SETUP.md`](docs/GOOGLE-DRIVE-SETUP.md)**.

## Command dasar

```bash
npm install
npm run dev      # development, http://localhost:3000
npm run build    # production build
npm start        # jalankan hasil build
```

## Setup database

Jalankan isi `supabase/schema.sql` di SQL Editor project Supabase kamu
sebelum mulai development.

## Update model (1 command)

Setiap ada perubahan model, cukup jalankan satu command dari root repo —
tidak perlu upload/paste manual. Script: baca IFC → convert ke GLB
(IfcConvert) → upload ke Supabase Storage → deteksi kategori (nama family
Revit) → isi tabel `elements` → tambah baris `model_versions` (versi naik,
viewer yang lagi kebuka auto-reload lewat Realtime).

```bash
node scripts/push-model.mjs <file.ifc> <project_id> [pushed_by]
```

Butuh Node 18+ (pakai `fetch` bawaan, tanpa `npm install`). Konfigurasi
diambil dari `.env.local` (`NEXT_PUBLIC_SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, `IFCCONVERT_PATH`, `SUPABASE_BUCKET`).

Kalau cuma mau generate SQL kategori untuk di-paste manual ke SQL Editor:

```bash
node scripts/ifc-to-elements-sql.mjs <file.ifc> <project_id> > elements.sql
```

## Deploy

Push ke GitHub → connect repo ke Vercel → isi env vars di
Settings → Environment Variables (Production & Preview terpisah kalau
project Supabase-nya beda) → redeploy setelah nambah/ubah env var.
