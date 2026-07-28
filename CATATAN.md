# Catatan Project — Revit Web Viewer

Catatan riwayat & panduan modifikasi. Dibuat supaya siapa pun (termasuk kamu
sendiri beberapa bulan lagi) bisa tahu **apa yang sudah dikerjakan, kenapa
begitu, dan apa yang pernah gagal** sebelum mengubah apa-apa.

**Update file ini setiap kali menambah/mengubah fitur besar.** Cukup tambah
baris di bagian [Riwayat Perubahan](#riwayat-perubahan) — tidak perlu panjang.

---

## Ringkasan project

Website presentasi model Revit ke client:

- Viewer 3D (GLB hasil convert dari IFC) dengan isolate, ukur, markup, dll
- Sheet PDF yang bisa diklik untuk memindahkan sudut kamera 3D
- Auto-update saat model baru di-push dari Revit (Supabase Realtime)
- Download file `.rvt` (disimpan di Google Drive)

**Stack:** Next.js 15 · React 19 · Three.js 0.170 · Tailwind · Supabase
(database + Realtime) · Google Drive API (penyimpanan file besar) · Vercel

---

## Peta file — di mana harus mengubah apa

| Mau ubah apa | Buka file |
|---|---|
| Semua isi viewer 3D (kontrol, tool, kamera) | `components/ModelViewer.tsx` |
| Panel struktur model (pohon kategori→elemen) | `components/SelectionTree.tsx` |
| Layer coret-coret / markup | `components/MarkupOverlay.tsx` |
| Layout halaman presentasi + sidebar sheet | `components/PresentClient.tsx` |
| Teks bahasa Indonesia & Inggris | `lib/i18n.ts` |
| Koneksi Supabase (anon & service role) | `lib/supabase.ts` |
| Langganan auto-update model | `lib/realtime.ts` |
| Struktur tabel database | `supabase/schema.sql` |
| Halaman presentasi client | `app/present/[projectId]/` |
| Halaman kelola model & sheet (admin) | `app/manage/[projectId]/` |
| Endpoint API | `app/api/*/route.ts` |
| Add-in Revit (C#) | `revit-addin/` |
| Script convert & push model | `scripts/` |

> `ModelViewer.tsx` adalah file terbesar dan paling sering disentuh. Hampir
> semua permintaan fitur viewer berujung ke sini.

---

## Kondisi fitur saat ini

### Kontrol navigasi 3D

| Input | Fungsi |
|---|---|
| Klik kiri + geser | Putar model (orbit) |
| Klik kiri (tanpa geser) | Pilih & isolate elemen |
| Scroll | Zoom |
| **Klik kiri + geser** (saat mode Diam) | Lihat sekeliling — kiri/kanan & atas/bawah, pelan |
| **Shift + klik kiri + geser** | Lihat kiri/kanan |
| **Shift + scroll** | Lihat atas/bawah |
| **Shift + roda tengah + geser** | Putar model (orbit) |
| **W / S** | Maju / mundur (rata, tidak menukik) |
| **A / D** | Geser kiri / kanan |
| **Q / E** | Naik / turun |

"Lihat sekeliling" memutar kamera **di tempat**; orbit **mengelilingi** model.

### Tool & tombol

- **Struktur (☰)** — pohon Kategori → Elemen, checkbox show/hide, kolom cari,
  klik nama = isolate + fokus
- **Putar / Geser / Ukur / Walkthrough** — dock kiri
- **Kecepatan (⚡)** — slider 0.1×–3× untuk gerak keyboard & walkthrough
- **Isolate** (Objek / Kategori), **Fokus**, **Diam**, **Section**, **Coret**, **Reset**
- **Ganti warna** elemen terpilih — di kotak info kiri bawah
- **Section box** — 6 slider (X+/X−, Y+/Y−, Z+/Z−) + Reset
- **Markup** — pena, panah, teks (diketik langsung di kanvas), undo, hapus, simpan PNG

---

## Riwayat Perubahan

Terbaru di atas. Format: `tanggal — ringkasan (hash commit)`.

### 28 Juli 2026
- Mode Diam: lihat sekeliling dipindah dari roda tengah ke **tahan klik kiri**,
  karena tombol tengah rawan direbut autoscroll browser (`5c98884`)
- Drag lihat-sekeliling dipindah ke listener `window` + autoscroll ditekan
  lewat `mousedown`/`auxclick` (`cfe484c`)
- Mode Diam: lihat sekeliling dengan tahan roda tengah — *diganti hari itu juga*
  oleh `5c98884` (`db1f3ea`)

### 27 Juli 2026
- **Fix:** Shift tidak lagi menurunkan kamera. Shift masih terdaftar sebagai
  tombol "turun" dari walkthrough lama, jadi menahannya membuat kamera
  meluncur turun terus (`536f6d3`)
- Kontrol Shift (orbit roda tengah, lihat atas/bawah, lihat kiri/kanan),
  tombol **Diam**, dan W/A/S/D jalan rata (`a2b303e`)
- **Revert** section box interaktif — kembali ke 6 slider (`337f700`)
- Section box interaktif dengan handle drag — *dibatalkan, lihat di atas* (`8d9b5fd`)
- Slider kecepatan gerak 3D (`4bf9022`)
- **Fix:** input teks markup tidak bisa diketik karena fokus dicuri kanvas (`de41384`)
- Markup teks diketik langsung di 3D, hapus pop-up `prompt` (`b92be1b`)
- Navigasi keyboard di mode orbit (`f6d18d9`)
- **Fix:** ukuran titik ukur dibuat konstan, walkthrough naik/turun,
  **fitur komentar dihapus** (`d1af02f`)
- Selection Tree, Pan, Ukur, Walkthrough, ganti warna, komentar tersimpan (`99f04ba`)

### 25 Juli 2026 dan sebelumnya
- Markup coret-coret di viewer 3D (`27202f2`)
- Isolate bisa on/off + perbaikan isolate objek/kategori (`4a4023f`)
- Section box (clipping planes X/Y/Z) (`ec9f8b5`)
- Tombol Focus + overlay status load model (`6659bd3`)
- `scripts/ifc-to-web.mjs` — 1 command IFC→GLB→Draco (`c486999`)
- Kompresi Draco untuk GLB besar (`808b48f`)
- Viewer full-width saat sidebar ditutup (`a81f7a3`)
- Checklist tampil sheet + sidebar sheet collapsible (`58c6a0c`)
- Sync Sheets + klik sheet pindah kamera (`d99d5f5`)
- Dual bahasa, dual tema, icon, delete project (`a434a55`)

---

## Fitur yang pernah dibuat lalu dibatalkan

Jangan diulang tanpa alasan baru — ini sudah pernah dicoba:

| Fitur | Nasib | Alasan |
|---|---|---|
| **Komentar/anotasi tersimpan** (pin 3D + tabel `comments` + API) | Dihapus | Diminta dihapus. Tabel `comments` juga sudah dibuang dari `schema.sql` |
| **Section box interaktif** (gizmo 6 handle bisa ditarik) | Di-revert | Dipakai terasa tidak enak; kembali ke 6 slider |
| **Markup teks pakai `window.prompt`** | Diganti | Pop-up mengganggu; sekarang input inline di kanvas |
| **Roda tengah untuk lihat sekeliling** | Diganti | Direbut autoscroll browser; pindah ke klik kiri |

---

## Catatan teknis penting (jebakan yang sudah pernah kena)

Baca ini sebelum mengubah `ModelViewer.tsx` — semuanya hasil bug nyata.

1. **Handler pointer/keyboard dipasang sekali saat mount.** Handler tidak
   melihat perubahan `useState` biasa. Untuk nilai yang dibaca di dalam
   handler, **pakai `useRef`** (`lockOnRef`, `toolRef`, `markupOnRef`, dst),
   lalu sinkronkan ke state hanya untuk keperluan tampilan.

2. **OrbitControls memasang listener `pointerdown` lebih dulu.** Jadi
   `controls.mouseButtons.*` harus sudah benar **sebelum** tombol ditekan —
   mengubahnya di dalam handler klik sudah terlambat. Itu sebabnya status
   Shift dilacak lewat `keydown`/`keyup`, bukan dibaca dari `event.shiftKey`
   saat klik.

3. **Satu tombol jangan punya dua arti.** Shift pernah dipetakan sebagai
   tombol "turun" sekaligus modifier — akibatnya menahan Shift membuat kamera
   meluncur turun. Sebelum memakai tombol sebagai modifier, pastikan dia tidak
   ada di pemetaan gerak.

4. **Tombol tengah tidak bisa diandalkan.** Autoscroll Chrome/Firefox merebut
   gerakan mouse. Kalau terpaksa memakainya, tekan `preventDefault()` pada
   `mousedown` **dan** `auxclick`, jangan hanya `pointerdown`.

5. **Drag jangan bergantung pada pointer capture di canvas.** OrbitControls
   melepas capture di `pointerup`-nya sendiri. Pasang listener
   `pointermove`/`pointerup` di **`window`** selama drag berlangsung.

6. **Objek penanda 3D harus di-skala tiap frame.** Titik ukur pernah jadi
   sangat besar saat kamera mendekat. Pakai sphere radius 1 lalu hitung
   skalanya dari jarak kamera tiap frame (lihat `updateOverlays`).

7. **Label 2D di atas 3D harus diproyeksikan tiap frame**, bukan sekali saat
   dibuat — kalau tidak, labelnya hilang/melenceng begitu kamera bergerak.

8. **Jangan iterasi mesh lewat `meshesByGlobalId`.** Map itu 1 entri per
   `globalId`; kalau banyak mesh punya nama sama, sebagian hilang dan isolate
   terlihat "tidak jalan". Pakai `forEachMesh()` yang melakukan `traverse`.

9. **Input HTML di atas kanvas bisa kehilangan fokus seketika**, karena
   `mousedown` kanvas mencuri fokus. Fokuskan lewat
   `setTimeout(() => input.focus(), 0)` dan jangan pasang `onBlur` yang
   menutup paksa.

10. **Model IFC sering berkoordinat jauh dari origin.** `frameCameraToObject()`
    memindahkan pusat model ke `(0,0,0)`. Semua perhitungan lain (section box,
    preset kamera) mengasumsikan model sudah di-center.

11. **`renderer.clippingPlanes` bersifat global** — memotong *semua* objek di
    scene, termasuk garis bantu/gizmo. Ini salah satu alasan section box
    interaktif dulu susah dirapikan.

12. **Selalu `npm run build` sebelum commit.** Error TypeScript sering baru
    muncul di tahap ini, bukan saat `npm run dev`.

---

## Konvensi commit & branch

**Format commit:** `tipe(scope): deskripsi singkat`

Tipe yang dipakai: `feat`, `fix`, `chore`, `refactor`, `docs`, `style`.
Scope di repo ini biasanya `web` untuk perubahan Next.js.

```
feat(web): slider kecepatan gerak 3D
fix(web): titik ukur ukuran konstan
docs: tambah CATATAN.md
```

Aturan main:

- Deskripsi pakai **bahasa Indonesia**, konsisten — jangan campur dengan Inggris
- Commit **kecil dan sering** lebih baik daripada satu commit besar berisi
  banyak perubahan tak berhubungan
- Badan commit dipakai untuk menjelaskan **kenapa**, bukan sekadar apa

**Branch:**

- `main` — production (yang di-deploy Vercel)
- Fitur baru: `feat/nama-fitur` · perbaikan: `fix/nama-bug`
- Sesi kerja bareng Claude memakai branch `claude/...`, lalu di-merge lewat
  Pull Request

---

## Environment variables

Semua env var didaftarkan di `README.md` dan `.env.local.example`.

Aturan yang tidak boleh dilanggar:

- **Jangan pernah** menulis API key langsung di kode
- `.gitignore` sudah memuat `.env*` (kecuali contoh) — cek ini sebelum commit
- `SUPABASE_SERVICE_ROLE_KEY` **server-side saja**, tidak boleh sampai ke
  browser. Yang boleh diekspos hanya `NEXT_PUBLIC_*` (dibatasi RLS)
- Kalau ada key yang telanjur ter-commit: **regenerate key itu** di dashboard
  provider. Menghapus dari commit terbaru tidak cukup — history git tetap
  menyimpannya

**Di Vercel:** isi lewat Settings → Environment Variables, pisahkan scope
Production / Preview / Development. Setelah menambah atau mengubah env var,
**wajib redeploy manual** — deployment yang sudah jalan tidak ikut terbarui.

---

## Alur kerja modifikasi

1. Buat branch dari `main`
2. Ubah kode — cek dulu bagian [Catatan teknis](#catatan-teknis-penting-jebakan-yang-sudah-pernah-kena)
3. Kalau menambah teks baru di UI, isi **dua bahasa** di `lib/i18n.ts` (id & en)
4. `npm run build` sampai hijau
5. Commit sesuai konvensi di atas
6. **Tambah satu baris di [Riwayat Perubahan](#riwayat-perubahan)**
7. Push → buat Pull Request → merge ke `main` → Vercel deploy otomatis

### Update model dari Revit

```bash
node scripts/push-model.mjs <file.ifc> <project_id> [pushed_by]
```

Atau untuk alur manual (convert dulu, upload lewat website):

```bash
node scripts/ifc-to-web.mjs <file.ifc>
```

Detail lengkap ada di `README.md`.
