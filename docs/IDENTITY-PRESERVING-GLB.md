# IFC ke GLB dengan identitas elemen

GLB adalah format geometri, bukan salinan database IFC. Untuk pemilihan per
elemen, simpan GlobalId pada node dan jangan gabungkan elemen menjadi batch
GPU instancing tanpa tabel identitas per instance.

## Konversi yang dianjurkan

Install dependency proyek dengan `npm ci`, lalu:

```powershell
.\IfcConvert.exe --use-element-guids "input.ifc" "input-raw.glb"
node scripts/prepare-identified-glb.mjs "input.ifc" "input-raw.glb" "output-web.glb"
```

Atau pakai pipeline proyek (IfcConvert harus ada di PATH atau IFCCONVERT_PATH):

```powershell
node scripts/ifc-to-web.mjs "input.ifc" "output-web.glb"
```

Kedua alur menyimpan `globalId`, `elementName`, dan `category` pada extras node
GLB. Ini adalah metadata dasar, bukan semua property sets, circuit, atau hasil
perhitungan electrical. Viewer yang diperbarui membacanya sebelum fallback ke
database. Upload GLB baru melalui alur Kelola yang sudah ada setelah patch viewer
diterapkan. Viewer lama belum membaca extras ini dengan benar.

Hindari `gltf-transform optimize` untuk alur ini. Menonaktifkan join dan simplify
saja belum menjamin bahwa optimasi lain tidak mengubah hubungan antar elemen.
Script kompresi proyek hanya memakai Draco, memeriksa identitas dan hierarki
sesudah round-trip, dan menolak input dengan EXT_mesh_gpu_instancing. Jika file
lama sudah kehilangan identitas instance, mulai ulang dari IFC; mengompres atau
memecah batch lama tidak menciptakan kembali GUID yang hilang.

## Hasil sampel pengguna

- IFC: 255.913.635 byte.
- GLB lama: 7.218.392 byte; 2.587 node bernama, 281 batch anonim / 16.640 instance.
- GLB dibuat ulang dengan IfcOpenShell 0.8.5: 19.318 node unik.
- Hasil Draco + metadata: 16.036.812 byte; semua node ber-GUID, nama, dan kategori.
- Seluruh 2.587 GUID yang masih terbaca di file lama tetap ada di file baru.
- Browser Three.js 0.170: 31.974 mesh dipetakan ke 19.318 identitas unik;
  nol mesh tanpa identitas/nama. Selain harness loader, komponen ModelViewer asli
  diuji di Next.js lokal: pencarian highbay, pemilihan elemen 625347, nama/kategori,
  dan isolate berhasil tanpa database. Deployment produksi belum diubah.
- IFC memiliki 19.424 produk dengan Representation. Tidak semua representasi
  menghasilkan geometri render. Pembuatan ulang juga memakai versi konverter
  berbeda; jumlah ini bukan jaminan kesetaraan seluruh geometri IFC atau audit desain.

Tradeoff: file lebih besar daripada GLB lama dan draw calls bisa lebih banyak,
tetapi identitas per elemen dipertahankan. Uji kinerja pada perangkat client.

## Pengujian

```powershell
node --test scripts/model-identity.test.mjs
npx tsc --noEmit
```

Perbaikan source diuji pada snapshot branch `claude/new-session-a8jevn` dari
`baguscandrautamamr/VIEWER`. Terapkan lewat review PR sebelum deployment.
Akses repository `maksum54/VIEWER` belum tersedia melalui koneksi saat audit.
