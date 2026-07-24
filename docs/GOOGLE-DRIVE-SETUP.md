# Setup Google Drive (OAuth user) — env `GOOGLE_OAUTH_*` & `GOOGLE_DRIVE_FOLDER_ID`

Dipakai `lib/googleDrive.ts` untuk upload/download file `.rvt` (spec bagian 2 & 5).

Env yang perlu diisi:

| Env | Isi |
|---|---|
| `GOOGLE_OAUTH_CLIENT_ID` | Client ID OAuth (langkah 2) |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Client secret OAuth (langkah 2) |
| `GOOGLE_OAUTH_REFRESH_TOKEN` | Refresh token, diambil sekali (langkah 4) |
| `GOOGLE_DRIVE_FOLDER_ID` | ID folder tujuan (langkah 5) |

> ⚠️ Semua ini kredensial rahasia. JANGAN di-commit. `.gitignore` sudah blok
> `.env*`. Isi value asli cuma di `.env.local` (dev) & dashboard Vercel (prod).

---

## Kenapa OAuth user, bukan service account? (soal biaya)

- **Google Drive API = gratis.** Tidak ada tagihan, tidak perlu aktifkan
  billing / kartu kredit. Yang kepakai kuota itu *storage*, bukan API call.
- **Service account punya kuota storage ~0.** File yang di-upload service
  account dimiliki oleh service account (bukan akunmu), jadi file `.rvt` besar
  gagal `storage quota exceeded` — walau folder-nya punya kamu. Nembusnya butuh
  **Shared Drive** yang perlu **Google Workspace (berbayar)**.
- **OAuth user → file dimiliki akun Google kamu**, masuk kuota **15 GB gratis**.
  Ini jalur gratis untuk file besar. Trade-off: ambil refresh token **sekali**
  di awal (langkah 4). Setelah itu jalan otomatis, token di-refresh sendiri.

> Kalau total file `.rvt` nanti > 15 GB, mau tak mau upgrade Google One
> (berbayar, ~Rp27rb/bln untuk 100 GB) atau terapkan retention (hapus versi
> lama) — lihat spec bagian 11.

---

## 1. Project + aktifkan Drive API

1. <https://console.cloud.google.com/> → buat/pilih project (misal `revit-web-viewer`).
2. Menu (☰) → **APIs & Services** → **Library** → cari **Google Drive API** → **Enable**.

## 2. Buat OAuth Client ID (tipe Desktop app)

1. **APIs & Services** → **OAuth consent screen** (kalau belum pernah):
   - User type **External** → isi nama app, email support, email developer → Save.
   - Di bagian **Scopes**, tidak wajib nambah manual (scope diminta saat auth).
2. **APIs & Services** → **Credentials** → **+ Create Credentials** →
   **OAuth client ID**.
3. Application type: **Desktop app** (penting — tipe ini otomatis mengizinkan
   redirect `http://localhost`, jadi tidak perlu daftar redirect URI manual).
4. **Create** → muncul **Client ID** & **Client secret**. Ini isi
   `GOOGLE_OAUTH_CLIENT_ID` & `GOOGLE_OAUTH_CLIENT_SECRET`.

## 3. Publish consent screen (WAJIB — biar token tidak expired)

**APIs & Services** → **OAuth consent screen** → **Publish app** → set status
ke **In production**.

> Kalau status dibiarkan **Testing**, refresh token **expired dalam 7 hari** dan
> upload tiba-tiba berhenti jalan. Di Production, refresh token tidak expired
> (kecuali kamu cabut akses / tidak dipakai 6 bulan). Untuk scope `drive.file`
> + pemakaian pribadi, publish biasanya langsung jalan; kalau muncul layar
> "Google hasn't verified this app", klik **Advanced → Go to (app)** — aman
> karena appmu sendiri.

## 4. Ambil refresh token (sekali jalan)

Dari root repo, set client id/secret ke environment lalu jalankan script bawaan:

```bash
export GOOGLE_OAUTH_CLIENT_ID='xxxx.apps.googleusercontent.com'
export GOOGLE_OAUTH_CLIENT_SECRET='xxxx'
node scripts/get-refresh-token.mjs
```

```powershell
# Windows PowerShell
$env:GOOGLE_OAUTH_CLIENT_ID='xxxx.apps.googleusercontent.com'
$env:GOOGLE_OAUTH_CLIENT_SECRET='xxxx'
node scripts/get-refresh-token.mjs
```

Script akan mencetak sebuah URL. Buka di browser → login akun Google kamu →
izinkan akses. Setelah itu terminal mencetak:

```
GOOGLE_OAUTH_REFRESH_TOKEN=1//0abc...
```

Copy baris itu ke `.env.local`.

> Kalau script bilang "tidak dapat refresh_token" (karena app sudah pernah
> diizinkan), cabut dulu di <https://myaccount.google.com/permissions> lalu
> ulangi.

## 5. Buat folder Drive & ambil `GOOGLE_DRIVE_FOLDER_ID`

1. <https://drive.google.com/> → buat folder (misal `RVT Files`).
2. Buka folder → lihat URL:
   `https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz`
   → bagian setelah `/folders/` = **`GOOGLE_DRIVE_FOLDER_ID`**.

> Tidak perlu di-share ke siapa pun: karena OAuth pakai akun kamu, folder ini
> memang sudah milik kamu.

## 6. Isi env var

### Dev — `.env.local` (di root repo, sudah gitignored)

```bash
cp .env.local.example .env.local
```

Isi:

```bash
GOOGLE_OAUTH_CLIENT_ID=xxxx.apps.googleusercontent.com
GOOGLE_OAUTH_CLIENT_SECRET=xxxx
GOOGLE_OAUTH_REFRESH_TOKEN=1//0abc...
GOOGLE_DRIVE_FOLDER_ID=1AbCdEfGhIjKlMnOpQrStUvWxYz
```

### Prod — dashboard Vercel

**Settings** → **Environment Variables** → tambahkan empat var yang sama
(scope **Production**, dan **Preview** kalau perlu) → **redeploy** (env var baru
tidak otomatis kepakai di deployment lama).

## 7. Tes cepat

```bash
npm run dev
# upload dites lewat add-in / app/api/push; untuk cek kredensial cukup resolve
# link file yang sudah ada di folder:
# GET http://localhost:3000/api/drive?fileId=<id-file-di-folder>
```

Balik `{ webViewLink, webContentLink }` → OAuth & folder OK. Kalau `invalid_grant`
→ refresh token salah/expired (cek langkah 3 soal Publish). Kalau `insufficient
permissions` saat upload ke folder → naikkan scope di
`scripts/get-refresh-token.mjs` dari `drive.file` ke `drive`, ambil ulang token.
