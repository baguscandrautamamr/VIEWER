import { google } from 'googleapis';
import { Readable } from 'stream';

// OAuth user (bukan service account): file .rvt dimiliki akun Google kamu
// sendiri, jadi masuk kuota 15GB gratis — bukan kuota ~0 service account
// yang bikin upload file besar gagal "storage quota exceeded".
//
// Refresh token diambil sekali lewat scripts/get-refresh-token.mjs, lalu
// disimpan di env. Tidak ada login interaktif saat runtime — token di-refresh
// otomatis oleh library. Lihat docs/GOOGLE-DRIVE-SETUP.md.
function getDriveClient() {
  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_OAUTH_CLIENT_ID!,
    process.env.GOOGLE_OAUTH_CLIENT_SECRET!
  );
  oauth2.setCredentials({
    refresh_token: process.env.GOOGLE_OAUTH_REFRESH_TOKEN!,
  });
  return google.drive({ version: 'v3', auth: oauth2 });
}

// Upload file .rvt ke folder yang sudah ditentukan (GOOGLE_DRIVE_FOLDER_ID).
// Dipanggil dari app/api/push/route.ts saat add-in menyertakan file RVT.
export async function uploadRvtFile(fileName: string, fileBuffer: Buffer) {
  const drive = getDriveClient();
  const res = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [process.env.GOOGLE_DRIVE_FOLDER_ID!],
    },
    media: {
      mimeType: 'application/octet-stream',
      body: Readable.from(fileBuffer),
    },
    fields: 'id, webViewLink',
  });
  return res.data; // { id, webViewLink } -> simpan id ke model_versions.rvt_drive_file_id
}

// Ambil link download untuk ditampilkan di DownloadRvtButton.
export async function getRvtDownloadLink(fileId: string) {
  const drive = getDriveClient();
  const res = await drive.files.get({
    fileId,
    fields: 'webViewLink, webContentLink',
  });
  return res.data;
}
