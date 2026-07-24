import { google } from 'googleapis';
import { Readable } from 'stream';

// Service account (bukan OAuth user) supaya add-in bisa upload otomatis
// tanpa perlu login interaktif tiap push.
function getDriveClient() {
  const credentials = JSON.parse(process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON!);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive.file'],
  });
  return google.drive({ version: 'v3', auth });
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
