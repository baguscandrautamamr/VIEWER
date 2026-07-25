# Revit Web Viewer — Add-in (Revit 2023 & 2025)

Tombol **Export & Push** di ribbon Revit. Sekali klik: export IFC dari 3D view
aktif → convert ke GLB (IfcConvert) → upload ke Supabase → deteksi kategori →
versi baru (viewer client auto-update). Ini pipeline yang sama dengan
`scripts/push-model.mjs`, tapi dari dalam Revit.

Satu source code, 2 target:
- **Revit 2023** → `.NET Framework 4.8` (`net48`)
- **Revit 2025** → `.NET 8` (`net8.0-windows`)

---

Revit API diambil dari NuGet (Nice3point), jadi build **tidak perlu** Revit
maupun Visual Studio terinstall. Yang perlu terinstall di mesin yang jalanin
Revit cuma: **IfcConvert.exe** (sudah ada di `C:\ifcconvert\`).

## 1. Build — pilih salah satu

### Cara A (disarankan): build di GitHub, tanpa install apa-apa
1. Buka repo di GitHub → tab **Actions** → workflow **Build Revit Add-in**.
   (Otomatis jalan tiap ada perubahan di `revit-addin/`; atau klik
   **Run workflow** buat jalanin manual.)
2. Tunggu centang hijau → buka run-nya → bagian **Artifacts** di bawah →
   download **`RevitWebViewer-addin`** (file zip).
3. Extract. Isinya:
   - `2023\` → DLL untuk **Revit 2023**
   - `2025\` → DLL untuk **Revit 2025**
   - `RevitWebViewer.addin`, README, config example.

### Cara B: build lokal (kalau punya .NET 8 SDK)
Dari folder `revit-addin/`:
```
dotnet build -c Release
```
Hasil: `bin\Release\net48\` (Revit 2023) & `bin\Release\net8.0-windows\` (Revit 2025).
Tiap folder berisi `RevitWebViewer.dll` + `Newtonsoft.Json.dll`.

## 2. Taruh DLL
Salin isi hasil build ke lokasi tetap (biar rapi), misal:
- `C:\RevitWebViewer\2023\`  ← isi folder `2023\` (artifact) / `bin\Release\net48\` (lokal)
- `C:\RevitWebViewer\2025\`  ← isi folder `2025\` (artifact) / `bin\Release\net8.0-windows\` (lokal)

## 3. Isi konfigurasi — lewat tombol Pengaturan (disarankan)
Sejak versi ini, **tidak perlu edit file JSON manual**. Setelah add-in
terpasang & Revit di-restart (langkah di bawah), buka tab **Revit Web Viewer**
→ klik **Pengaturan**, lalu isi:

| Field | Isi |
|---|---|
| Supabase URL | `https://vruzkcpotrwlkxbfpqhg.supabase.co` |
| Service Role Key | service_role key (Supabase → Project Settings → API). **RAHASIA.** |
| Project ID | pakai tombol **Pilih…** (ambil dari Supabase) atau **Buat…** (bikin project baru langsung dari Revit). Tidak perlu buka SQL Editor. |
| Bucket | `models` (default) |
| IfcConvert.exe | `C:\ifcconvert\IfcConvert.exe` (pakai tombol **Cari…**) |
| Present Base URL | domain Vercel kamu (opsional, buat cetak link) |

Klik **Simpan** → tersimpan di
`%AppData%\RevitWebViewer\revit-web-viewer.config.json` (1 config dipakai
Revit 2023 & 2025 sekaligus). Kalau kamu klik **Export & Push** sebelum
mengisi, dialog langsung menawarkan buka Pengaturan.

> **Cara lama (manual)** masih didukung: salin
> `revit-web-viewer.config.example.json` → `revit-web-viewer.config.json` di
> folder yang sama dengan DLL, lalu isi. Kalau kedua lokasi ada, yang di
> `%AppData%` menang.
>
> `revit-web-viewer.config.json` sudah di-gitignore — jangan pernah di-commit.

## 4. Daftarkan ke Revit (.addin manifest)
Salin `RevitWebViewer.addin` ke folder Addins tiap versi, lalu **edit path
`<Assembly>`-nya ke DLL versi yang cocok**:

| Revit | Taruh .addin di | `<Assembly>` isinya |
|---|---|---|
| 2023 | `%AppData%\Autodesk\Revit\Addins\2023\` | `C:\RevitWebViewer\2023\RevitWebViewer.dll` |
| 2025 | `%AppData%\Autodesk\Revit\Addins\2025\` | `C:\RevitWebViewer\2025\RevitWebViewer.dll` |

(`%AppData%` = ketik itu di address bar Explorer, langsung kebuka.)

## 5. Jalankan
1. **Restart total** Revit (bukan cuma tutup file).
2. Muncul tab **Revit Web Viewer** → tombol **Export & Push** dan **Pengaturan**.
3. Klik **Pengaturan** dulu, isi form, **Simpan** (lihat langkah 3 di atas).
4. Buka **3D view yang sudah di-isolate ke electrical** → klik **Export & Push**.
5. Muncul dialog "Sukses — Versi vN". Viewer client yang lagi kebuka auto-update.

---

## Troubleshoot cepat
- **Tab nggak muncul** → cek path `<Assembly>` di `.addin` absolut & benar, lalu restart Revit total. Cek juga versi .addin ada di folder Addins yang cocok.
- **"Konfigurasi belum lengkap / belum diisi"** → klik tombol **Pengaturan** dan isi form. Tersimpan di `%AppData%\RevitWebViewer\`.
- **IfcConvert error** → cek path IfcConvert.exe di **Pengaturan** (tombol **Cari…**).
- **Mismatch versi API** (add-in error saat diklik) → DLL 2023 harus dari `net48`, DLL 2025 dari `net8.0-windows`. Jangan ketuker.
- **Harus 3D view** → tombol nolak kalau view aktif bukan 3D. Buka 3D view dulu.
