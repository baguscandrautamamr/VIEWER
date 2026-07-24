# Setup Google Drive — dapatkan `GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON` & `GOOGLE_DRIVE_FOLDER_ID`

Dua env var ini dipakai `lib/googleDrive.ts` untuk upload/download file `.rvt`
(lihat spec bagian 2 & 5). Pakai **service account** (bukan OAuth user) supaya
add-in Revit bisa upload otomatis tanpa login interaktif tiap push.

> ⚠️ File JSON service account = kredensial rahasia. JANGAN pernah di-commit.
> `.gitignore` sudah memblok `.env*`. Isi value asli cuma di `.env.local`
> (dev) dan dashboard Vercel (prod).

---

## 1. Buat / pilih project di Google Cloud

1. Buka <https://console.cloud.google.com/>.
2. Pojok kiri atas → dropdown project → **New Project** (atau pakai yang sudah
   ada). Kasih nama, misal `revit-web-viewer`. Klik **Create**.

## 2. Aktifkan Google Drive API

1. Menu (☰) → **APIs & Services** → **Library**.
2. Cari **Google Drive API** → klik → **Enable**.

## 3. Buat service account

1. **APIs & Services** → **Credentials** → **+ Create Credentials** →
   **Service account**.
2. Isi nama, misal `revit-drive-uploader` → **Create and Continue**.
3. Role tidak perlu diisi (akses diatur lewat sharing folder, bukan IAM
   project) → **Continue** → **Done**.
4. Catat **email** service account-nya, bentuknya seperti:
   `revit-drive-uploader@revit-web-viewer.iam.gserviceaccount.com`
   (dipakai di langkah 6 untuk share folder).

## 4. Generate kunci JSON

1. Di daftar Credentials, klik service account tadi → tab **Keys**.
2. **Add Key** → **Create new key** → pilih **JSON** → **Create**.
3. File `.json` otomatis ter-download. Ini isi dari
   `GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON`.

## 5. Ubah JSON jadi satu baris untuk env var

`lib/googleDrive.ts` memanggil `JSON.parse(...)`, jadi value-nya harus JSON
valid. Paling aman: jadikan **satu baris** (newline di dalam `private_key`
tetap sebagai `\n` — jangan diutak-atik).

Di terminal (ganti path ke file hasil download):

```bash
# macOS / Linux — hasilnya JSON satu baris, tinggal copy
cat ~/Downloads/revit-web-viewer-xxxx.json | tr -d '\n'
```

```powershell
# Windows PowerShell
(Get-Content -Raw ~\Downloads\revit-web-viewer-xxxx.json) -replace "`r`n","" -replace "`n",""
```

## 6. Buat folder Drive & ambil `GOOGLE_DRIVE_FOLDER_ID`

1. Buka <https://drive.google.com/> → buat folder, misal `RVT Files`.
2. Buka folder itu. Lihat URL:
   `https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz`
   → bagian setelah `/folders/` itulah **`GOOGLE_DRIVE_FOLDER_ID`**.
3. **PENTING** — share folder ke email service account (langkah 3.4):
   klik kanan folder → **Share** → paste email service account →
   beri akses **Editor** → **Send**. Tanpa ini, upload akan gagal
   `403 / File not found` walau kredensial benar.

> Catatan: kalau file .rvt besar tapi service account kena kuota storage,
> pindahkan folder ke **Shared Drive** dan tambahkan service account sebagai
> member — storage ikut Shared Drive, bukan kuota service account.

## 7. Isi env var

### Dev — `.env.local` (di root repo, sudah di-gitignore)

Copy dari contoh lalu isi:

```bash
cp .env.local.example .env.local
```

Isi dua baris ini (JSON dibungkus **single quote**, ditulis satu baris):

```bash
GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON='{"type":"service_account","project_id":"...","private_key":"-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n","client_email":"...","...":"..."}'
GOOGLE_DRIVE_FOLDER_ID=1AbCdEfGhIjKlMnOpQrStUvWxYz
```

### Prod — dashboard Vercel

Vercel → project → **Settings** → **Environment Variables**:

| Name | Value |
|---|---|
| `GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON` | tempel JSON satu baris (tanpa quote pembungkus — Vercel simpan apa adanya) |
| `GOOGLE_DRIVE_FOLDER_ID` | folder id dari langkah 6 |

Set scope **Production** (dan **Preview** kalau perlu). Setelah simpan,
**redeploy** — env var baru tidak kepakai di deployment yang sudah jalan.

## 8. Tes cepat

Setelah `.env.local` terisi & folder di-share:

```bash
npm run dev
# lalu panggil endpoint drive dengan fileId apa saja yang ada di folder:
# GET http://localhost:3000/api/drive?fileId=<id-file-di-folder>
```

Kalau balik JSON `{ webViewLink, webContentLink }` → kredensial & sharing OK.
Kalau `403` / `File not found` → cek lagi langkah 6.3 (folder belum di-share
ke email service account) atau scope API di langkah 2.
