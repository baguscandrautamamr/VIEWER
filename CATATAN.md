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
- **Mode presentasi** (gaya virtual plant tour): jalan kaki/orbit/**statis**
  (kamera beku), tur terpandu otomatis, navigator & inspeksi elemen, label,
  minimap, section box dengan bingkai 3D, **Asisten AI** yang bisa menggerakkan
  viewer

**Stack:** Next.js 15 · React 19 · Three.js 0.170 · Tailwind · Supabase
(database + Realtime) · Google Drive API (penyimpanan file besar) ·
`@anthropic-ai/sdk` (Asisten AI, Messages API — bisa lewat proxy) · Vercel

---

## Peta file — di mana harus mengubah apa

| Mau ubah apa | Buka file |
|---|---|
| Semua isi viewer 3D (kontrol, tool, kamera) | `components/ModelViewer.tsx` |
| **Mode presentasi** — tampilan & panel (React) | `components/showcase/ShowcaseViewer.tsx` (+ `ExplorePanel`, `TourCard`, `EquipmentNavigator`, `InspectionPanel`, `AiPanel`, `ui.tsx`) |
| Mesin 3D mode presentasi (Three.js murni: material, kamera, jalan kaki, label, minimap) | `lib/showcase/engine.ts` |
| Tur tersimpan: tabel, endpoint, editor | `supabase/schema.sql` (`tour_stops`), `app/api/tour/route.ts`, `lib/showcase/tourStore.ts`, `components/showcase/TourEditor.tsx` |
| Tur otomatis (pose kamera per pemberhentian) | `lib/showcase/tour.ts` |
| Pengelompokan disiplin (Struktur/Arsitektur/MEP) dari nama family | `lib/showcase/disciplines.ts` |
| Pencarian elemen & penerjemah query AI → elemen | `lib/showcase/search.ts` |
| Endpoint AI + prompt + protokol aksi | `app/api/ai/route.ts`, `lib/showcase/aiPrompt.ts`, `lib/showcase/aiActions.ts` |
| Saklar Mode presentasi / Mode teknis | `components/PresentClient.tsx` |
| Tema CSS mode presentasi (kelas `sc-*`) | `app/globals.css` (bagian bawah) |
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
| Klik kiri (tanpa geser) | Pilih elemen — kotak penanda; model lain tetap utuh |
| **Shift + klik kiri (tanpa geser)** | Pilih objek di BALIK objek yang sekarang (bertumpuk) |
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
  klik nama = isolate + fokus, tombol **☑ Semua** & **☐ Kosongkan** di kepala panel
- **Putar / Geser / Ukur / Walkthrough** — dock kiri
- **Auto-fokus** — kamera DIAM kalau elemen sudah kelihatan jelas (≥25% tinggi
  layar & di dalam layar); mendekat beranimasi kalau tampil kecil atau di luar
  layar. Tombol **Fokus** memaksa mendekat ke elemen terpilih
- **Kotak objek terpilih** — kategori/nama/GlobalId + palet warna (↺ reset) +
  Sembunyikan. Ringkas satu baris. Sementara, tidak masuk database
- **Kecepatan (⚡)** — slider 0.1×–3× untuk gerak keyboard & walkthrough
- **Tampilan (💡)** — kecerahan 0.4×–2.5× + warna latar (tema/terang/putih/gelap)
- **Pintasan (?)** — daftar pintasan keyboard & mouse
- **Layar penuh (⛶)** — viewer + semua overlay jadi layar penuh
- **Isolate** (Objek / Kategori) — **bawaannya MATI**; nyalakan kalau ingin objek
  lain diredupkan saat satu objek dipilih. **Fokus**, **Diam**, **Section**,
  **Coret**, **Reset**
- **Section box** — 6 slider (X+/X−, Y+/Y−, Z+/Z−) + Reset
- **Markup** — pena, panah, teks (diketik langsung di kanvas), undo, hapus, simpan PNG

---

## Riwayat Perubahan

Terbaru di atas. Format: `tanggal — ringkasan (hash commit)`.

### 7 September 2026
- **Mode presentasi: Mode statis** — pill ketiga di topbar (sebelah Mode jalan
  & Mode orbit). Kamera BEKU seperti Mode teknis: OrbitControls dimatikan
  (tidak bisa diputar/zoom), keyboard W/A/S/D/Q/E diabaikan, tooltip hover
  tidak dihitung. Klik tetap memilih elemen dan tombol E tetap membuka
  inspeksi — dipakai untuk memotret tampilan yang harus sama persis berulang.
  Kembali ke orbit/jalan dengan pill yang sama; posisi kamera dipertahankan.
  Tur tersimpan boleh memakai mode `static` (kolom `mode` tabel `tour_stops`
  menerima nilai itu; data lama tanpa `static` tidak berubah).
- **Kotak section di 3D (mode presentasi)** — saat Section aktif, bingkai kawat
  hijau menggambar kotak potong di scene dan mengikuti 6 slider X/Y/Z secara
  langsung (sebelumnya hasil potongan hanya terlihat, batasnya tidak). Garis
  `depthTest=false` supaya tetap terlihat di balik dinding, dipasang ke scene
  (bukan model) supaya luput dari raycast & ikut hilang saat model diganti.
  Posisi bidangnya memakai rumus yang sama dengan plane clipping
  (`cx + hx*xMax` dst.) — dua-duanya dihitung di `refreshClipping()`, jadi
  tidak mungkin tidak sinkron.

### 6 September 2026
- **Fix: 3D tidak tampil sama sekali (layar kosong) — WebGL context lost.**
  Penyebabnya penggandaan geometri di penggabung: `addPiece` dipanggil per
  INSTANCE mesh dan tiap instance menyalin seluruh vertex geometrinya,
  padahal di model Revit banyak elemen BERBAGI geometri yang sama (tipe
  family yang sama muncul puluhan kali). Model 3,5 juta segitiga unik
  mengembang jadi ~34 juta segitiga / ~78 juta vertex ≈ 3,2 GB, alokasi
  buffer GPU gagal, konteks WebGL dilepas, layar kosong.
- **Perbaikan: geometri berulang dirender sebagai InstancedMesh.** Geometri
  yang dipakai ≥ 4 kali (atau ≥ 2 kali kalau > 2.000 segitiga) disimpan
  SEKALI; tiap elemen hanya menyumbang satu matriks 4×4 + satu warna
  (`instanceColor`). Geometri unik tetap digabung per petak seperti
  sebelumnya. Identitas, sorotan, warna asli, dan klik-pilih tetap per elemen.
  Uji A/B pada model yang sama (17k elemen, 6,5 juta segitiga digambar):
  **563 MB → 199 MB** heap JS, siap 16,6 s → 10,5 s.
- **Memilih objek pada instans**: sinar dipindah ke ruang lokal geometri
  (satu invers matriks per kandidat), diuji ke segitiga geometri bersama,
  lalu titik tembusnya dikembalikan ke ruang dunia untuk dibandingkan.
- **`webglcontextlost` ditangkap**: viewer menampilkan pesan yang jelas
  ("memori grafis habis…") + saran pakai Mode teknis, bukan layar kosong.
- Panel bantuan (?) sekarang menampilkan `X juta segitiga (Y unik · N
  geometri berulang)` — kalau angka "digambar" jauh lebih besar dari "unik",
  berarti instancing sedang bekerja.
- **Catatan jujur:** diagnosis awal datang dari user yang mengecek lewat
  asisten lain; klaimnya (34,3 juta segitiga & 78,5 juta vertex dari 3,5 juta
  unik) cocok dengan kode dan dengan hitungan memori. Uji sandbox sebelumnya
  TIDAK menangkap ini karena model uji buatan sendiri hanya punya 6 geometri
  berbagi dengan pengulangan rendah — pelajaran: model uji harus meniru pola
  PENGULANGAN geometri model asli, bukan sekadar jumlah elemen.

### 5 September 2026 (larut)
- **Fix: halaman membeku ("Halaman Tidak Merespons") SETELAH model selesai
  dimuat.** Laporan user: 17.448 elemen sudah terbaca, dock sudah muncul,
  lalu 0 FPS dan Chrome menawarkan keluar dari halaman. Biangnya
  `new MeshBVH(...)` — dipanggil sekali secara SINKRON tepat setelah model
  siap; pada geometri puluhan juta segitiga itu memblokir main thread
  bermenit-menit. **three-mesh-bvh dibuang seluruhnya.**
- **Memilih objek tanpa BVH.** Sinar diuji ke KOTAK BATAS tiap elemen (data
  yang memang sudah dihitung saat menggabung, disimpan sebagai satu
  `Float32Array` datar, slab test tanpa alokasi), kandidat diurutkan
  berdasarkan jarak, lalu segitiga hanya diuji pada segelintir kandidat
  terdekat dan berhenti begitu ada tembakan yang lebih dekat dari kotak
  berikutnya. Diukur: **6–13 ms per klik** pada 17k–60k elemen, hasilnya
  persis (klik di langit kosong tetap "tidak ada"), dan **nol** biaya
  pembangunan indeks
- **Petak (tile) + frustum culling.** Geometri gabungan dipecah per petak
  denah (grid maksimum 6×6, ~1.500 potongan per petak) × padat/tembus. Petak
  di luar layar dilewati GPU — penting saat berjalan di dalam bangunan besar.
  Draw call tetap belasan, bukan puluhan ribu
- **Penyesuaian kualitas otomatis.** Di atas 6 juta segitiga bayangan
  dimatikan sendiri (lintasan bayangan menggandakan kerja vertex) dan user
  diberi tahu lewat toast; di atas 1,5 juta segitiga peta bayangan diturunkan
  ke 1024². Ada juga jaring pengaman: kalau FPS < 6 selama ~3 detik,
  bayangan dimatikan sekali. Semua bisa dinyalakan lagi dari panel kiri
- **Jumlah segitiga ditampilkan** di panel bantuan (?) bersama jumlah elemen
  dan FPS — untuk mendiagnosis model berat
- Cara mengukurnya (penting kalau nanti curiga ada blokir lagi): jalankan
  Playwright dengan `drawElements`/`drawArrays` di-stub jadi no-op
  (`scratchpad/jsonly.mjs`). Tanpa itu, biaya rasterisasi software SwiftShader
  di sandbox (detik per frame) menutupi kerja JS. Hasil setelah perbaikan:
  jeda JS terburuk setelah siap **193 ms** (60k elemen) / **217 ms**
  (8 juta segitiga) — sebelumnya bermenit-menit

### 5 September 2026 (malam)
- **Fix: model besar bikin halaman "stuck" di layar Menyiapkan model 3D.**
  Tiga sebab, semuanya diperbaiki: (1) penggabungan geometri dijalankan DUA
  KALI (sekali saat model dimuat, sekali lagi saat nama elemen datang dari
  database) — sekarang sekali saja, nama yang datang belakangan hanya
  memperbarui teks; (2) tiap vertex menyimpan 4 array warna Float32 (48 byte)
  — sekarang 1 array Uint8 + 1 warna asli Uint8 (8 byte), sisanya konstanta,
  jadi memori puncak turun drastis dan geometri sumber dilepas begitu selesai
  disalin; (3) penggabungan menumpang render loop, padahal di mesin lambat
  satu frame bisa ratusan ms — sekarang dijadwalkan sendiri
  (`setTimeout`, jatah 24 ms per potongan) dan menggambar direm jadi ~4 fps
  selama menyiapkan. Uji 60.062 elemen di sandbox (software GL): siap dalam
  **9,1 detik** vs **64,4 detik** sebelum perbaikan
- **Fix: klik memilih elemen yang SALAH pada model besar.** `three-mesh-bvh`
  mengurutkan ulang index buffer saat membangun BVH, sedangkan pemetaan
  "nomor segitiga → elemen" mengandalkan urutan asli. Identitas dipindah ke
  penanda per-VERTEX (`vertexEid`, di CPU saja) yang tidak ikut terurut
- **Upload GPU jadi parsial.** Tiap potongan penggabungan sempat memanggil
  `needsUpdate = true` pada seluruh buffer — three lalu mengirim ULANG seluruh
  posisi/normal/index (bisa ratusan MB) tiap potongan. Sekarang pakai
  `addUpdateRange` hanya untuk potongan yang baru disalin
- **InstancedMesh tidak lagi hilang.** Versi sebelumnya melewati
  `isInstancedMesh` saat menggabung, jadi objek hasil GPU instancing lenyap
  dari tampilan. Sekarang tiap instance dibentangkan jadi potongan sendiri
- **Progres unduh jujur.** `/api/model/[versionId]` & `/api/model-file/[id]`
  meneruskan `Content-Length` dari Drive (hanya kalau respons tidak
  di-gzip), jadi bar progres menunjukkan persen sebenarnya; kalau ukuran
  tidak diketahui, yang tampil MB terunduh + bar berjalan — bukan persen palsu
  yang terlihat macet. Saklar **Mode teknis** ikut dirender di atas layar
  loading sebagai jalan keluar kalau model terlalu berat
- **Tata letak overlay dirombak supaya tidak tumpang tindih.** Baris atas jadi
  satu flex row (brand · mode kamera · saklar mode + live + bantuan), kolom
  kiri/kanan dan baris bawah memakai variabel jarak yang sama
  (`--sc-right-inset` bergeser saat panel samping terbuka), dock/kartu tur
  otomatis menyusut di antara panel kiri dan minimap, chip area & minimap ikut
  bergeser, status kiri bawah dipendekkan, label 3D & tooltip menghindari area
  panel lewat `engine.setInsets()`. Diuji otomatis: kotak semua overlay
  dibandingkan berpasangan di 1400/1100/900 px × 4 kondisi — nol perpotongan

### 5 September 2026 (sore)
- **Performa mode presentasi: geometri digabung.** Keluhan "3D sangat lambat
  saat navigasi" di model asli. Penyebab: tiap elemen = 1 mesh = 1 draw call
  (puluhan ribu per frame, ×2 karena shadow pass) + raycast hover ke semua
  mesh. Sekarang `lib/showcase/engine.ts` menyalin seluruh model ke DUA
  geometri gabungan (padat & tembus pandang) dengan warna RGBA per-vertex;
  sorotan/seleksi/gaya cukup menulis ulang rentang vertex milik elemen
  (upload parsial `addUpdateRange` kalau ≤300 elemen). Raycast pakai BVH
  (`three-mesh-bvh`, dibangun setelah frame pertama), shadow map statis
  (`autoUpdate=false`), pixel ratio dibatasi 1,5. Uji 30.062 elemen di
  sandbox (software GL): ~264 ms/frame vs ~1.031 ms/frame mode teknis; di GPU
  sungguhan selisihnya jauh lebih besar karena yang hilang adalah overhead
  draw call
- **Tur terpandu bisa disusun & disimpan.** Tabel baru `tour_stops`
  (schema.sql, idempotent), route `app/api/tour` (GET token client; PUT
  admin), editor `components/showcase/TourEditor.tsx` (dock **Susun tur**,
  hanya `canEdit` = admin). Pemberhentian menyimpan pose kamera, mode
  (jalan/orbit/denah), dan sorotan aktif (daftar gid atau kategori disiplin).
  Kalau ada tur tersimpan, itu yang dipakai; kalau kosong, tur otomatis
- **MEP dipecah** jadi Elektrikal & elektronik, Plumbing, HVAC, Proses,
  Pemadam kebakaran (`lib/showcase/disciplines.ts`, aturan kata kunci dengan
  urutan prioritas). Berlaku ke sorot sistem, tur otomatis, konteks AI

### 5 September 2026
- **Mode presentasi + Asisten AI.** Viewer baru `components/showcase/*` yang
  meniru gaya video referensi "virtual plant tour": model monokrom + sorotan
  hijau limau, lantai grid + bayangan, panel gelap kaca; **mode jalan** (eye
  level 1,7 m, WASD, seret untuk menoleh, crosshair + "sedang melihat" + tombol
  E) dan **mode orbit**; **tur terpandu otomatis** (ikhtisar → per disiplin →
  jalan kaki → tampak atas) dengan animasi kamera; **navigator elemen**
  (pencarian toleran, dikelompokkan per kategori); **inspeksi elemen** (dimensi
  & elevasi dari kotak batas, elemen sejenis/sekitar); **label elemen** (maks 14,
  tersebar per kategori, anti-tumpang tindih kasar); **minimap** (jejak elemen,
  kamera + kerucut pandang, penanda tur, klik = teleport); sorot sistem per
  disiplin; gaya monokrom/warna asli; simpan PNG. Viewer lama tetap ada sebagai
  **Mode teknis** (saklar di tengah-atas, diingat di localStorage).
  **AI:** `POST /api/ai` (SDK `@anthropic-ai/sdk`, env `ANTHROPIC_API_KEY`,
  `ANTHROPIC_BASE_URL` untuk proxy, `AI_MODEL`) dengan tiga mode: `chat`
  (streaming; AI bisa menggerakkan viewer lewat baris `[[action:{...}]]`),
  `explain` (fungsi elemen terpilih), `tour` (narasi pemberhentian, JSON).
  Dijaga token akses client + pembatas laju per IP. Tanpa kunci, tombol AI
  disembunyikan.
  Diuji end-to-end dengan GLB sintetis + mock Supabase/Messages API lewat
  Playwright (proxy vikey tidak bisa dijangkau dari sandbox pengerjaan — alur
  ke API asli belum diverifikasi, cek log Vercel saat pertama dipakai)

### 28 Juli 2026
- **Fix: klik kolom malah kena "hantu" tanpa kategori.** Sinar pemilihan tidak
  peduli material, jadi elemen tembus pandang (volume ruang/kaca) yang di layar
  nyaris tak terlihat tetap tertembus lebih dulu dan memakan klik yang
  diarahkan ke kolom di belakangnya. Sekarang objek **padat diutamakan**, objek
  tembus pandang (opacity < 0.35) ditaruh paling belakang, dan yang benar-benar
  tak terlihat (opacity ~0) tidak bisa diklik sama sekali. Bobotnya dihitung
  dari material ASLI, bukan material saat itu — isolate menggantinya dengan
  material redup yang transparan
- **Parser IFC: grid/ruang/bukaan/anotasi tidak lagi dibuang**, tapi dicatat
  dengan kategori dipaksa `IFCGRID`/`IFCSPACE`/`IFCOPENINGELEMENT`/
  `IFCANNOTATION` (bukan dari nama family — nama grid isinya cuma "A"/"1", bisa
  jadi puluhan kategori sampah). Dulu dibuang total, akibatnya "hantu" ini
  tampil "Tanpa kategori" tanpa nama: tidak bisa dikenali, tidak bisa
  dimatikan. Viewer memperlakukan kategori itu sama seperti objek tembus
  pandang saat memilih. **Perlu impor ulang IFC** supaya berlaku
- **Shift + klik = tembus objek yang bertumpuk.** Objek yang diincar sering
  terhalang elemen lain (mis. elemen besar tak terlihat yang menutupi kolom).
  Shift + klik di titik yang sama memajukan pilihan ke objek berikutnya di
  belakangnya, dan kotak terpilih menampilkan penanda "2/5 ⇧". Tidak bentrok
  dengan Shift + geser (menoleh) karena yang itu berakhir dengan `moved = true`
- **Klik objek jadi mirip Navisworks.** Tiga perubahan sekaligus:
  (1) kamera **diam** kalau elemen sudah kelihatan jelas — mendekat hanya kalau
  elemen tampil kecil (<25% tinggi layar) atau di luar layar; (2) elemen
  terpilih ditandai **kotak batas** dan model lain **tidak lagi diredupkan**
  (Isolate jadi pilihan, bawaannya mati); (3) **isolate & kotak kini per ELEMEN,
  bukan per mesh** — elemen yang terpecah jadi beberapa primitive (beda
  material) dulu cuma menyala sebagian, dan potongan bersuffix `_1` gagal
  dicari namanya sehingga ikut tampil "Tanpa kategori"
- **Fix: klik objek besar malah zoom OUT.** Jarak fokus dulu `maxDim * 2.5`,
  jadi atap 60 m menarik kamera ke 150 m — lebih jauh dari posisi user. Sekarang
  jarak dihitung dari FOV + aspect (bola pembatas) dan **dibatasi jarak kamera
  saat itu**, sehingga klik objek tidak pernah menjauh
- **Fix: fitting cable tray (tee/bend) tampil "Tanpa kategori".** Objeknya di
  GLB dinamai ANGKA — itu ElementId Revit, bukan GlobalId — jadi pencarian ke
  tabel `elements` meleset. Dijodohkan lewat ekor Name IFC
  (`Family:Type:1073322`), indeks cadangan dibangun di viewer. Tidak perlu
  impor ulang, data yang sudah ada langsung terpakai
- **Tombol auto-fokus (🎯) dihapus** — perilakunya tetap, selalu aktif
- Kotak objek terpilih **diperkecil**: warna, ↺, dan tombol Sembunyikan jadi
  satu baris; label "Terpilih"/"Warna" dibuang, GlobalId pindah ke ujung kanan
- **Ukur menampilkan selisih X / Y / Z** setelah titik kedua diklik, di bawah
  angka jarak. Dipetakan ke konvensi Revit (Z = tinggi), bukan sumbu mentah
  Three.js — GLB hasil IfcConvert itu Y-up sedangkan IFC/Revit Z-up
- **Aksi ke objek terpilih, auto-fokus, & Kosongkan.** Tiga permintaan sekaligus:
  (1) kotak "Selected" dapat palet warna + tombol Sembunyikan objek, dan ikut
  bergeser saat panel Struktur dibuka (sebelumnya tertutup panel);
  (2) klik objek di 3D memicu kamera mendekat **beranimasi** lewat tween di
  animate loop, dengan tombol 🎯 untuk mematikannya; (3) tombol **☐ Kosongkan**
  sebagai pasangan **☑ Semua** di kepala panel Struktur.
  **Fitur ganti warna dihidupkan lagi** setelah sempat dihapus — kali ini
  warnanya bertahan saat isolate karena `restoreMesh` mengembalikan material
  warna lebih dulu, baru material asli
- **Fix: nama elemen hilang pada model besar.** Query `elements` di viewer
  belum dipaginasi, jadi dari 22.317 baris hanya ~1000 pertama yang terbaca —
  elemen di bagian belakang file IFC (mis. elektrikal) tetap tampil sebagai
  GlobalId. Sekarang dipaginasi
- **Tombol "Impor nama elemen dari IFC"** di halaman Kelola — alternatif tanpa
  Command Prompt. File IFC dibaca bertahap di browser (tidak di-upload), yang
  dikirim ke `/api/elements` cuma daftar `{guid, category, name}` per batch
- **Nama elemen muncul di viewer.** `ifc-to-web.mjs` sekarang menerima
  `project_id` opsional dan langsung mengisi tabel `elements` (tidak perlu
  paste SQL manual lagi); viewer mengambil kolom `name` dan memakainya sebagai
  label di Selection Tree + kotak info. Halaman Kelola memperingatkan kalau
  tabel `elements` masih kosong. Logika upsert dipindah ke
  `scripts/lib/push-elements.mjs`, dipakai bareng `push-model.mjs`
- Tombol **layar penuh (⛶)** di dock; **fitur ganti warna elemen dihapus**
- Panel **Tampilan (💡)**: slider kecerahan + pilihan warna latar, tersimpan di
  `localStorage`. Pencahayaan default dinaikkan (ambient + hemisphere + key +
  fill) supaya tidak terlalu gelap dibanding tampilan Shaded di Revit
- Hint dirapikan: dipindah ke bawah-tengah, satu baris kecil, dan daftar
  pintasan lengkap dipindah ke panel **?** — sebelumnya menabrak deretan
  tombol di kanan atas
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
| **Ganti warna elemen** (palet di kotak info) | Dihapus lalu **dihidupkan lagi** (28 Juli 2026) | Sempat diminta dihapus, lalu diminta kembali bersama tombol Sembunyikan objek. Sekarang `colorMatByGid` dipakai di dalam `restoreMesh()` supaya warna bertahan saat isolate |
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

13. **Bagian bawah-tengah viewer dipakai bergantian** oleh toolbar coret,
    legenda walkthrough, hasil ukur, dan hint tool. Sebelum menaruh elemen
    baru di sana, cek dulu supaya tidak bertumpuk (lihat variabel `showHint`).

14. **GLB TIDAK menyimpan nama elemen — hanya GlobalId.** IfcConvert dijalankan
    dengan `--use-element-guids`, jadi tiap objek dinamai kode 22 karakter
    seperti `3uhIYbu7PDC9vFY0yt1$EN`. Nama & kategori yang bisa dibaca manusia
    hidup di tabel **`elements`**, hasil parsing nama family dari file IFC.
    Kalau tabel itu kosong, viewer terpaksa menampilkan kode acak dan semua
    elemen jatuh ke kategori "Default" — ini **bukan** karena kompresi Draco
    merusak file. Isi tabelnya dengan
    `node scripts/ifc-to-web.mjs <file.ifc> <project_id>`.

    Jangan tergoda mengganti flag ke `--use-element-names`: nama memang langsung
    muncul tanpa database, tapi GlobalId hilang — padahal itu satu-satunya
    identitas yang stabil antar versi, dipakai untuk highlight perubahan dan
    penyimpanan data per-elemen.

15. **Baca file besar bertahap: teks yang belum utuh harus DIBAWA, bukan
    diproses lalu dibuang.** Di `ImportElements.tsx`, kalau satu potongan belum
    memuat baris baru, seluruh isinya disimpan untuk disambung ke potongan
    berikutnya. Versi pertama memprosesnya lalu mengosongkan penyangga —
    akibatnya entity yang terbelah di batas potongan hilang diam-diam (tidak
    error, cuma jumlahnya kurang). Pembatasnya **baris baru**, bukan `;`,
    karena `;` bisa muncul di dalam nama seperti `"Ruang; Kantor"`.

16. **Query Supabase ke tabel besar WAJIB paginasi.** PostgREST/Supabase
    membatasi jumlah baris per permintaan (bawaannya **1000**) dan **tidak
    memberi error** kalau datanya lebih banyak — sisanya hilang diam-diam.
    Gejalanya menipu: tabel `elements` terisi 22.317 baris, halaman Kelola
    melaporkan angka itu dengan benar, tapi di viewer sebagian besar elemen
    tetap tampil sebagai GlobalId di kategori "Default" — karena browser cuma
    menerima 1000 baris pertama (= elemen di awal file IFC, biasanya
    arsitektur; elektrikal ada di belakang).

    Pola paginasi yang aman: maju sebanyak baris yang **benar-benar diterima**
    (`from += data.length`), berhenti saat satu halaman mengembalikan 0 baris.
    Jangan maju sebesar ukuran halaman dan jangan berhenti saat halaman lebih
    pendek dari yang diminta — batas server bisa lebih kecil dari yang kita
    minta. Lihat pemuatan `elements` di `ModelViewer.tsx`.

17. **Animasi kamera harus jalan di animate loop, dan mengalah pada user.**
    Tween disimpan di `flyRef` lalu di-lerp tiap frame **sebelum**
    `controls.update()` — OrbitControls menghitung ulang offset dari
    posisi+target, jadi keduanya tidak berebut. Tween dibatalkan
    (`flyRef.current = null`) di `pointerdown`, `wheel`, tombol gerak,
    `frameCameraToObject`, dan preset kamera. Tanpa itu, kamera terasa "melawan"
    saat user menggerakkan mouse di tengah animasi. Urutan event menyelamatkan
    seleksi: `pointerdown` (batal) → `pointerup` → `click` (mulai tween baru).

18. **Auto-fokus jangan mengubah ARAH pandang.** Versi pertama `focusOnMesh`
    memaksa arah isometrik `(1, 0.8, 1)`; hasilnya tiap klik pandangan ikut
    berputar dan user kehilangan orientasi. Sekarang arah pandang sekarang
    dipertahankan — kamera cuma meluncur mendekat dari sisi yang sedang dilihat.
    Jaraknya juga dibatasi `camera.near * 20` supaya objek kecil tidak tembus
    bidang near.

19. **Jarak fokus harus dihitung dari FOV, dan tidak boleh melebihi jarak
    kamera saat itu.** `maxDim * 2.5` terlihat masuk akal untuk elemen kecil,
    tapi untuk objek besar (atap/lantai/dinding yang membentang sepanjang gedung)
    hasilnya kamera **mundur** — klik atap 60 m menaruh kamera di 150 m,
    padahal user cuma 40 m dari model, jadi terasa seperti zoom out. Sekarang:
    jarak pas dihitung dari bola pembatas + FOV/aspect, lalu diambil yang
    terkecil antara itu dan jarak kamera sekarang (`Math.min(fit, current)`),
    dengan batas bawah `camera.near * 20`. Bola pembatas dipakai supaya hasilnya
    tidak berubah-ubah tergantung arah objek menghadap.

20. **"Sudah dekat" harus diukur dari besarnya di LAYAR, bukan dari jarak.**
    Jarak 10 m itu dekat untuk atap tapi jauh untuk sekrup, jadi ambang berupa
    meter selalu salah untuk salah satu pihak. `isWellVisible()` memakai dua
    syarat: elemen ada di dalam frustum kamera **dan** tingginya di layar
    melewati `MIN_SCREEN_COVERAGE` (jari-jari bola ÷ separuh tinggi layar pada
    jarak itu). Frustum-nya perlu, karena elemen raksasa di belakang kamera
    "besar" secara hitungan tapi tidak kelihatan sama sekali.

21. **Satu elemen bisa jadi BEBERAPA mesh Three.js.** Kalau geometrinya punya
    lebih dari satu material, GLTFLoader membuat satu Mesh per primitive dan
    menamainya lewat `createUniqueName` → `GUID`, `GUID_1`, `GUID_2`
    (`GLTFLoader.js`, `mesh.name = parser.createUniqueName(...)`). Akibatnya dulu
    isolate cuma menyalakan potongan yang kena klik, dan potongan bersuffix
    gagal dicari namanya. `normalizeMeshId()` membuang akhiran `_N` — tapi hanya
    kalau sisanya masuk akal sebagai id (22 karakter = GlobalId, atau semua
    angka = ElementId), supaya GlobalId yang kebetulan berakhiran `_1` tidak
    ikut terpotong. Semua operasi per elemen memakai `forEachMeshOfGid()`.

22. **Penanda seleksi ditaruh di SCENE, bukan di dalam model.** `Box3Helper`
    ditambahkan ke `scene`, jadi otomatis luput dari raycast (yang menembak
    `modelRoot`) dan dari `forEachMesh` (yang menelusuri `modelRoot`). Kalau
    ditaruh di dalam model, kotaknya bisa ikut terpilih, ikut diredupkan
    isolate, dan ikut terhitung di Selection Tree. Materialnya `depthTest:
    false` supaya kotak tetap terlihat walau elemennya di balik dinding.
    Kotaknya masih ikut terpotong section box — itu konsekuensi
    `renderer.clippingPlanes` yang global (lihat poin 11).

23. **Warna manual hidup di `restoreMesh()`, bukan di pemanggilnya.** Kalau
    warna dipasang langsung ke mesh, isolate akan menghapusnya (isolate memanggil
    `restoreMesh` yang mengembalikan material asli). Karena itu `colorMatByGid`
    dibaca **di dalam** `restoreMesh`: material warna dulu, material asli kalau
    tidak ada. Materialnya juga di-dispose saat model diganti di `loadModel`.

24. **"Kosongkan" cukup menandai KATEGORI, bukan puluhan ribu GlobalId.** Di
    panel Struktur elemen sudah terhitung tersembunyi kalau kategorinya
    tersembunyi (`hiddenIds.has(...) || catHidden`), jadi `hideAll()` mengisi
    `hiddenCategories` saja dan mengosongkan `hiddenIds` — sekali kategori
    dicentang, seluruh isinya langsung ikut tampil. Mengisi `hiddenIds` dengan
    22 ribu id tidak salah, tapi mubazir dan bikin sekali centang kategori tidak
    memunculkan apa-apa.

25. **Objek yang disembunyikan wajib punya jalan pulang.** Tombol "Sembunyikan
    objek" memakai `setElementVisible()` yang sama dengan checkbox, jadi
    centangnya ikut lepas di panel Struktur dan bisa dikembalikan dari sana atau
    lewat "☑ Semua". Isolate ikut dilepas — kalau tidak, yang tersisa di layar
    cuma model redup tanpa objek yang jadi pusat perhatian. Pesan singkat di
    kanan bawah memberitahu cara mengembalikannya.

26. **Kotak "Selected" dan panel Struktur sama-sama di kiri.** Kotak info harus
    ikut bergeser (`left: treeOpen ? '17rem' : '0.75rem'`, sama seperti dock),
    kalau tidak dia tertutup panel saat panel dibuka.

27. **Sumbu Three.js ≠ sumbu Revit. Y-up vs Z-up.** glTF/GLB wajib Y-up, jadi
    IfcConvert memutar model saat convert: yang di Revit sumbu **Z (tinggi)**
    menjadi **y** di scene, dan Y mendatar Revit menjadi **z**. Selisih sumbu di
    tool Ukur karena itu dipetakan `X = |dx|`, `Y = |dz|`, `Z = |dy|` — kalau
    dipakai apa adanya, "Z" yang tampil justru jarak mendatar dan angkanya
    membingungkan orang yang terbiasa Revit. Tandanya dibuang (nilai mutlak),
    jadi arah putaran Y vs −Y tidak perlu dipusingkan.

28. **Tidak semua objek GLB dinamai GlobalId — sebagian bernama ANGKA.** Itu
    ElementId Revit. Gejalanya: sebagian besar model bernama benar, tapi
    segelintir elemen (sering fitting seperti tee/bend cable tray) tetap
    "Tanpa kategori" walaupun tabel `elements` sudah penuh dan parser IFC-nya
    terbukti menangkap elemen itu. Jangan buru-buru menyalahkan parser: cek
    dulu GlobalId yang tampil di kotak objek terpilih — kalau isinya angka
    (bukan 22 karakter), penyebabnya penamaan GLB, bukan parsing.

    Penyelamatnya: ElementId itu ikut tertulis di ekor Name IFC
    (`Family:Type:1073322`), jadi viewer membangun indeks cadangan
    `elementByElementId` dan `nameOf`/`categoryOf` jatuh ke sana kalau
    pencarian GlobalId meleset. Kunci sepanjang 22 karakter dikecualikan
    (`altKeyOf`) supaya GUID yang kebetulan diawali angka tidak salah jodoh.

29. **Model terlihat gelap karena pencahayaan default Three.js terlalu minim.**
    Tampilan Shaded Revit itu rata & terang, jadi porsi cahaya menyebar
    (ambient + hemisphere) harus besar, dan perlu lampu isi dari sisi
    berlawanan supaya sisi yang membelakangi cahaya tidak hitam pekat. Nilai
    dasar ada di konstanta `BASE_LIGHT`.

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

28. **Mode presentasi: yang berjalan tiap frame JANGAN lewat React.** Label
    elemen, minimap, label elemen terpilih, dan tween kamera dikerjakan
    langsung ke DOM/canvas di `lib/showcase/engine.ts` (pola: kumpulan `div`
    yang dipakai ulang, `transform` diubah tiap frame). React hanya menerima
    event (`select`, `hover`, `stats` 2×/detik). Versi awal yang memakai
    `setState` per frame membuat halaman tersendat di model besar.

29. **Tween kamera pakai waktu NYATA, bukan `dt` yang di-clamp.** `dt` untuk
    gerak keyboard di-clamp 0,1 s supaya lompatan saat tab tidak aktif tidak
    membuat kamera terbang jauh. Tapi kalau tween ikut memakai `dt` itu, di
    mesin lambat (5 FPS) animasi 1,5 s molor jadi 3 s lebih dan tombol
    "Berikutnya" terasa tidak merespons. Tween memakai `dtRaw` (batas 0,5 s).

30. **GUID duplikat di GLB = elemen digabung.** Indeks elemen di engine di-key
    GlobalId; mesh yang GUID-nya sama dianggap satu elemen (memang begitu untuk
    elemen multi-material). Kalau viewer melaporkan jumlah elemen jauh lebih
    sedikit dari yang diharapkan, cek dulu GUID-nya unik — ini pernah menipu
    saat menguji dengan GLB sintetis yang generator GUID-nya rusak.

31. **`toneMapping` renderer mempengaruhi warna material asli.** ACES cocok
    untuk tampilan monokrom, tapi menggelapkan warna material Revit. Saat ganti
    gaya, tone mapping diganti (`NoToneMapping` untuk warna asli) dan SEMUA
    material ditandai `needsUpdate = true` — tanpa itu shader lama masih dipakai
    dan perubahan tidak terlihat.

32. **Aksi AI = format teks `[[action:{...}]]`, bukan tool-use API.** Pilihan
    sadar: proxy seperti vikey meneruskan ke model non-Claude yang belum tentu
    mendukung tool-use ala Messages API, dan format teks tetap bisa di-stream.
    Parser (`lib/showcase/aiActions.ts`) membuang potongan aksi yang belum utuh
    saat streaming supaya tidak sempat tampil mentah. Query aksi diterjemahkan
    ke elemen lewat `resolveQuery()` — kategori diutamakan bila skornya
    sebanding, supaya "tunjukkan kolom" menyorot semua kolom, bukan satu.

33. **Endpoint AI wajib dijaga.** `/api/ai` mengecek `projectId` + token client
    ke `projects.client_access_token` dan membatasi laju per IP. Tanpa itu,
    siapa pun yang tahu URL bisa memakai kuota API lewat endpoint terbuka.
    Jangan pernah mengirim `ANTHROPIC_API_KEY` ke browser.

34. **Elemen di panel kanan & modal navigator sama-sama memakai kelas
    `.sc-result`.** Kalau menulis uji otomatis, pakai selektor
    `.sc-modal .sc-result` — klik ke `.sc-result` pertama bisa mengenai daftar
    "Di sekitarnya" di panel inspeksi yang tertutup backdrop modal.

35. **Mode presentasi menggabungkan geometri — jangan cari `THREE.Mesh` per
    elemen.** Setelah dimuat, model = 2 mesh gabungan; elemen hanya punya
    daftar RENTANG vertex/segitiga (`ElementRecord.ranges`). Sembunyikan/
    ubah warna/pilih = tulis warna RGBA per vertex pada rentang itu (alpha 0
    kalau mau "menyembunyikan"). Raycast mengembalikan `faceIndex` → gid lewat
    binary search di `MergedPart.tri`. Kalau butuh fitur per-elemen baru,
    kerjakan lewat rentang ini, bukan menambah mesh.

36. **Sumber GLB dipertahankan sampai nama dari DB datang.** Nama/kategori
    mempengaruhi pembagian padat vs tembus (kategori non-fisik seperti
    IFCSPACE dipindah ke bagian tembus pandang), jadi `applyNames()` menyusun
    ulang geometri dari sumber, baru sumber dibuang (`sourceRoot = null`).
    Memori dobel hanya sebentar. Kalau `elements` kosong di DB, sumber tetap
    dipegang — wajar, cuma memori lebih besar.

37. **BVH dibangun setelah frame pertama; sebelum siap, klik diabaikan.**
    Model jutaan segitiga butuh beberapa detik untuk BVH. Supaya layar tidak
    beku saat model baru tampil, BVH dijadwalkan lewat `setTimeout` per
    bagian. `pickNdc()` melewati bagian yang `bvhReady=false`.

38. **Shadow map statis: set `renderer.shadowMap.needsUpdate = true` setiap
    kali ada yang berubah di scene** (model diganti, lampu digeser, bayangan
    di-toggle). Warna vertex tidak mempengaruhi bayangan, jadi sorotan tidak
    perlu memicu update. Kalau bayangan "tertinggal" setelah perubahan baru,
    hampir pasti lupa baris ini.

39. **Kata "column" ≠ proses.** Aturan disiplin proses sempat memuat
    `column|tower`, akibatnya semua kolom struktur masuk "Proses". Aturan
    diuji berurutan (pemadam → HVAC → proses → plumbing → elektrikal →
    struktur → arsitektur); kata generik harus ditaruh di aturan yang paling
    mungkin benar untuk model gedung, atau dibuat spesifik
    (`distillation`, `cooling column`).

40. **Pemberhentian tur denah (`plan`) dari editor menyimpan pose apa adanya.**
    Tur otomatis memakai `engine.plan()` (pose dihitung dari bounds), tur
    tersimpan memakai `goTo(pose,'orbit')` lalu mengunci putaran — supaya
    denah yang disimpan admin (zoom/posisi tertentu) tidak ditimpa pose
    otomatis.

41. **Jangan menggabungkan geometri lebih dari sekali.** Nama & kategori dari
    tabel `elements` datang setelah model dimuat; menyusun ulang geometri
    untuk itu berarti mengerjakan pekerjaan terberat dua kali. Pembagian
    padat/tembus pandang karena itu diputuskan dari MATERIAL saja (opacity),
    bukan kategori. Kategori non-fisik (IFCSPACE dll.) ditangani saat
    memilih: kalau sinar mengenainya, dicari lagi benda nyata di belakangnya.

42. **`needsUpdate = true` tanpa `addUpdateRange` = kirim ulang SELURUH
    buffer.** three baru mengirim sebagian kalau `updateRanges` diisi, dan ia
    membersihkan daftar itu sendiri setelah upload. Satuannya elemen array
    (posisi itemSize 3 -> `vStart * 3`), bukan jumlah vertex.

43. **BVH mengurutkan ulang index buffer.** Jangan pernah memetakan
    `hit.faceIndex` ke data sendiri kalau geometri punya `boundsTree` —
    urutannya sudah berubah. Pakai `hit.face.a` (indeks VERTEX, tidak ikut
    berubah) ke tabel per-vertex.

44. **Pekerjaan berat jangan menumpang render loop.** Kalau satu frame lambat
    (GPU lemah, software rendering, layar besar), pekerjaan yang dicicil di
    dalam `requestAnimationFrame` ikut merayap. Jadwalkan sendiri dengan
    `setTimeout` dan rem penggambaran selama proses berlangsung.

45. **Tata letak overlay pakai variabel jarak bersama, bukan angka lepas.**
    `--sc-right-inset` berubah saat panel samping terbuka, dan minimap, chip
    area, serta baris bawah semuanya mengikutinya. Panel baru WAJIB ikut pola
    ini, dan area yang ditempati panel harus dikabarkan ke mesin lewat
    `engine.setInsets()` supaya label 3D tidak menyelinap ke bawah panel.
    Uji tumpang tindih ada di `scratchpad/overlap.mjs` (kotak semua overlay
    dibandingkan berpasangan).

46. **Jangan bangun BVH (atau indeks berat apa pun) di main thread.**
    `new MeshBVH()` untuk geometri puluhan juta segitiga = halaman mati
    bermenit-menit, dan tidak ada API untuk mencicilnya. Untuk kebutuhan
    "klik memilih objek" beberapa kali per detik, uji kotak batas + segitiga
    kandidat sudah jauh lebih dari cukup dan tidak butuh pembangunan indeks.

47. **Ukur blokir JS dengan menonaktifkan gambar, bukan dengan FPS.** Di
    sandbox tanpa GPU, satu frame bisa memakan detik dan menutupi semuanya.
    Stub `WebGLRenderingContext.prototype.drawElements` lewat
    `page.addInitScript`, lalu ukur jeda terburuk antar `requestAnimationFrame`.

48. **Frustum culling butuh bola pembatas yang BENAR.** Petak dibuat dengan
    `frustumCulled = false` dulu (bola masih sebesar model), baru dinyalakan
    di `finishMerge` setelah `min`/`max` tiap petak terkumpul dari vertex yang
    sudah ditransformasi. Kalau bolanya terlalu kecil, sebagian model hilang
    saat kamera bergerak — dan itu tidak selalu kelihatan di model uji kecil.

49. **Kotak batas bukan jawaban akhir saat memilih.** Kalau segitiga sebuah
    elemen sudah diuji dan meleset, jangan jatuhkan ke jarak kotaknya — klik
    di ruang kosong akan memilih elemen yang kebetulan kotaknya kena sinar.
    Kotak hanya dipakai untuk elemen yang sengaja dilewati karena terlalu
    besar (> 60.000 segitiga).

50. **Menggabungkan geometri = MENGGANDAKAN geometri yang dipakai berulang.**
    Ini jebakan paling mahal di viewer ini: renderer per-mesh menyimpan
    geometri sekali dan menggambarnya N kali; penggabung menyalinnya N kali.
    Di model Revit, pengulangan 10× itu biasa. Selalu hitung
    `useCount` per `BufferGeometry` dulu, dan arahkan yang berulang ke
    InstancedMesh. Ukuran file GLB TIDAK memberi petunjuk soal ini — file
    5 MB bisa mengembang jadi ratusan MB di memori.

51. **Ukur memori, bukan cuma waktu.** `performance.memory.usedJSHeapSize`
    (Chrome, dengan `--enable-precise-memory-info`) memberi angka yang bisa
    dibandingkan A/B. Layar kosong tanpa error di console hampir selalu
    berarti konteks WebGL hilang — pasang listener `webglcontextlost`.

52. **Warna pada InstancedMesh lewat `instanceColor`, bukan warna per-vertex.**
    Materialnya harus putih (warna dikalikan), dan alpha tidak tersedia per
    instans — jadi transparansi untuk kelompok instans ditentukan materialnya.

53. **Grup material bikin draw call berlipat di InstancedMesh.** Satu kotak
    Three punya enam grup; kalau tiap grup jadi kelompok instans sendiri,
    satu geometri berulang berubah jadi enam `InstancedMesh`. Gabungkan grup
    yang memakai MATERIAL yang sama jadi satu sub-geometri (index-nya
    disambung), baru buat instansnya.

54. **`setTimeout(0)` bersarang diklem ~4 ms oleh browser.** Dengan potongan
    kerja 8 ms, klem itu sendiri memakan sekitar sepertiga waktu penyiapan.
    Penjadwal yang tidak diklem: `MessageChannel` + `postMessage` (pola yang
    dipakai scheduler React). Pembatalannya lewat state (`this.merge = null`),
    bukan `clearTimeout`.

55. **Frame yang tidak berubah tidak perlu digambar.** Render hanya kalau
    kamera bergeser/berputar atau ada penanda `renderDirty` (warna, ukuran,
    bayangan, konteks pulih). Konsekuensinya: SETIAP perubahan yang terlihat
    wajib menyalakan penanda itu, dan penghitung FPS "berat" harus memakai
    frame yang benar-benar digambar — bukan jumlah putaran loop.

56. **Mencicil pekerjaan tidak cukup per objek — harus bisa berhenti di tengah
    objek.** Satu mesh 90 ribu vertex melewati anggaran waktu berapa pun kalau
    potongan hanya bisa putus di batas mesh. Simpan kursor (vertex, grup,
    index, cat) di state penggabungan dan lanjutkan dari situ.

57. **Mengecat ulang seluruh rentang elemen tiap potongan itu kuadratik.**
    Elemen Revit dengan ratusan mesh akan dicat ulang ratusan kali. Cat hanya
    rentang yang baru ditambahkan — berlaku untuk jalur gabungan MAUPUN jalur
    instans.

58. **Matriks bercermin (determinan negatif) membalik urutan putar segitiga.**
    Saat transformasi mesh dipanggang ke posisi vertex, muka depan jadi
    menghadap ke dalam dan objek terlihat "bolong". Tukar dua index terakhir
    tiap segitiga untuk piece yang matriksnya bercermin.
