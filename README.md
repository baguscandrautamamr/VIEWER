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

## Fitur viewer 3D

### Kontrol navigasi

| Input | Fungsi |
|---|---|
| Klik kiri + geser | Putar model (orbit) |
| Klik kiri (tanpa geser) | Pilih & isolate elemen |
| Scroll | Zoom |
| **Klik kiri + geser** (mode Diam) | Lihat sekeliling — kiri/kanan & atas/bawah, pelan |
| **Shift + roda tengah + geser** | Putar model (orbit) |
| **Shift + scroll** | Pandangan kamera atas/bawah |
| **Shift + klik kiri + geser** | Pandangan kamera kiri/kanan |
| **W / S** | Maju / mundur — **rata**, tidak menukik |
| **A / D** | Geser kiri / kanan |
| **Q / E** | Naik / turun |

Tombol keyboard diabaikan saat sedang mengetik di kolom cari. Pandangan
kiri/kanan & atas/bawah memutar kamera **di tempat** (posisi tidak pindah),
berbeda dengan orbit yang mengelilingi model.

Toolbar kiri (gaya Navisworks) + kontrol kanan atas:

- **Struktur (☰)** — Selection Tree hierarki *Kategori → Elemen*. Checkbox
  untuk show/hide per kategori/elemen, klik nama untuk isolate + fokus, ada
  kolom cari.
- **Putar / Geser (Pan) / Walkthrough** — tool navigasi. Pan = seret untuk
  menggeser; Walkthrough = jalan first-person: **W/S** maju-mundur, **A/D**
  geser, **Q** naik, **E** turun, mouse lihat, **Esc** keluar.
- **Kecepatan (⚡)** — slider di dock kiri untuk mengatur kecepatan gerak
  keyboard/walkthrough (0.1×–3×) supaya jalan di 3D tidak terlalu cepat.
- **Ukur (Measure)** — klik 2 titik pada model, jarak tampil (meter) + garis &
  titik di 3D. Ukuran titik konstan di layar; label jarak tetap menempel saat
  kamera digerakkan.
- **Ganti Warna** — pilih elemen lalu pilih warna di kotak info (kiri bawah).
- **Diam** — kunci putaran supaya model tidak berputar tak sengaja saat
  presentasi. Klik kiri berhenti memutar (seleksi elemen tetap jalan), inersia
  dimatikan sehingga berhenti seketika. Sebagai gantinya **tahan klik kiri +
  geser** untuk melihat sekeliling secara perlahan (kiri/kanan & atas/bawah);
  klik tanpa geser tetap memilih/isolate elemen. Zoom, geser, dan keyboard
  tetap berfungsi; memutar model tetap bisa lewat **Shift + roda tengah**.
- Ditambah fitur lama: Isolate (objek/kategori), Section box (6 slider),
  Coret markup, Fokus, auto-update saat model di-push.

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

## Kecilkan GLB besar (Draco) — untuk model >200MB

Model IFC besar sering menghasilkan GLB ratusan MB yang berat di-load di web.
`push-model.mjs` sudah **otomatis** meng-kompres GLB dengan Draco
(KHR_draco_mesh_compression) sebelum upload — biasanya hemat 70–90%.

### Alur manual (upload lewat website)

**Paling praktis — 1 command dari IFC langsung jadi GLB kecil siap upload:**

```bash
node scripts/ifc-to-web.mjs <file.ifc> [output.glb]
```

Ini menjalankan IfcConvert (IFC→GLB) lalu kompres Draco sekaligus. Hasilnya
`<nama-ifc>-web.glb` — tinggal upload di halaman Kelola (Upload model GLB).
Butuh `IFCCONVERT_PATH` di `.env.local` (atau `IfcConvert` ada di PATH).

**Kalau GLB-nya sudah ada** (convert sendiri via Blender / converter online),
tinggal kompres saja sebelum upload:

```bash
node scripts/compress-glb.mjs <input.glb> [output.glb]
```

Hasilnya (`<input>-draco.glb`) yang di-upload di halaman Kelola. Kalau file
sangat besar dan kena "heap out of memory", jalankan dengan heap lebih besar:

```bash
node --max-old-space-size=8192 scripts/compress-glb.mjs <input.glb>
```

Kompresi butuh dependency dev (`@gltf-transform/*`, `draco3dgltf`) — sudah
masuk `package.json`, cukup `npm install`. Viewer sudah mendukung GLB Draco
(decoder di-serve dari `public/draco`, tanpa CDN).

## Deploy

Push ke GitHub → connect repo ke Vercel → isi env vars di
Settings → Environment Variables (Production & Preview terpisah kalau
project Supabase-nya beda) → redeploy setelah nambah/ubah env var.
