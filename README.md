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
| `GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON` | Credential service account untuk upload/download file RVT |
| `GOOGLE_DRIVE_FOLDER_ID` | Folder tujuan upload file RVT |

Copy `.env.local.example` ke `.env.local` dan isi value asli sebelum `npm run dev`.

Cara dapat dua env Google Drive di atas (bikin service account, JSON key,
share folder, ambil folder id): lihat **[`docs/GOOGLE-DRIVE-SETUP.md`](docs/GOOGLE-DRIVE-SETUP.md)**.

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

## Deploy

Push ke GitHub → connect repo ke Vercel → isi env vars di
Settings → Environment Variables (Production & Preview terpisah kalau
project Supabase-nya beda) → redeploy setelah nambah/ubah env var.
