# Revit Web Viewer — Add-in (Revit 2023 & 2025)

Tombol **Export & Push** di ribbon Revit. Sekali klik: export IFC dari 3D view
aktif → convert ke GLB (IfcConvert) → upload ke Supabase → deteksi kategori →
versi baru (viewer client auto-update). Ini pipeline yang sama dengan
`scripts/push-model.mjs`, tapi dari dalam Revit.

Satu source code, 2 target:
- **Revit 2023** → `.NET Framework 4.8` (`net48`)
- **Revit 2025** → `.NET 8` (`net8.0-windows`)

---

## Prasyarat (sekali)
- **Visual Studio 2022** (workload *.NET desktop development*) **+ .NET 8 SDK**.
- Revit **2023** dan/atau **2025** terinstall (buat DLL RevitAPI-nya).
- **IfcConvert.exe** (sudah kamu punya di `C:\ifcconvert\`).

Kalau Revit terinstall di lokasi non-default, edit `Revit2023Dir` /
`Revit2025Dir` di `RevitWebViewer.csproj`.

## 1. Build
Dari folder `revit-addin/`:

```
dotnet build -c Release
```

(atau buka `RevitWebViewer.csproj` di Visual Studio → Build → Release)

Hasilnya 2 folder:
- `bin\Release\net48\`           → DLL untuk **Revit 2023**
- `bin\Release\net8.0-windows\`  → DLL untuk **Revit 2025**

Tiap folder berisi `RevitWebViewer.dll` + `Newtonsoft.Json.dll`.

## 2. Taruh DLL + config
Salin isi folder build ke lokasi tetap (biar rapi), misal:
- `C:\RevitWebViewer\2023\`  ← isi dari `bin\Release\net48\`
- `C:\RevitWebViewer\2025\`  ← isi dari `bin\Release\net8.0-windows\`

Di **tiap** folder itu, bikin file konfigurasi:
1. Salin `revit-web-viewer.config.example.json` → `revit-web-viewer.config.json`
2. Isi nilainya:
   - `SupabaseUrl` → `https://vruzkcpotrwlkxbfpqhg.supabase.co`
   - `ServiceRoleKey` → service_role key (Supabase → Project Settings → API). **RAHASIA.**
   - `ProjectId` → id project (mis. `222f2676-94d5-4f72-9a4c-9b033fef5a6e`)
   - `IfcConvertPath` → `C:\\ifcconvert\\IfcConvert.exe`
   - `PresentBaseUrl` → domain Vercel kamu (buat cetak link)

> `revit-web-viewer.config.json` sudah di-gitignore — jangan pernah di-commit.

## 3. Daftarkan ke Revit (.addin manifest)
Salin `RevitWebViewer.addin` ke folder Addins tiap versi, lalu **edit path
`<Assembly>`-nya ke DLL versi yang cocok**:

| Revit | Taruh .addin di | `<Assembly>` isinya |
|---|---|---|
| 2023 | `%AppData%\Autodesk\Revit\Addins\2023\` | `C:\RevitWebViewer\2023\RevitWebViewer.dll` |
| 2025 | `%AppData%\Autodesk\Revit\Addins\2025\` | `C:\RevitWebViewer\2025\RevitWebViewer.dll` |

(`%AppData%` = ketik itu di address bar Explorer, langsung kebuka.)

## 4. Jalankan
1. **Restart total** Revit (bukan cuma tutup file).
2. Muncul tab **Revit Web Viewer** → tombol **Export & Push**.
3. Buka **3D view yang sudah di-isolate ke electrical** → klik **Export & Push**.
4. Muncul dialog "Sukses — Versi vN". Viewer client yang lagi kebuka auto-update.

---

## Troubleshoot cepat
- **Tab nggak muncul** → cek path `<Assembly>` di `.addin` absolut & benar, lalu restart Revit total. Cek juga versi .addin ada di folder Addins yang cocok.
- **"Config tidak ditemukan"** → `revit-web-viewer.config.json` harus ada di folder yang sama dengan DLL.
- **IfcConvert error** → cek `IfcConvertPath` di config.
- **Mismatch versi API** (add-in error saat diklik) → DLL 2023 harus dari `net48`, DLL 2025 dari `net8.0-windows`. Jangan ketuker.
- **Harus 3D view** → tombol nolak kalau view aktif bukan 3D. Buka 3D view dulu.
