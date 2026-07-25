import { google } from 'googleapis';
import { Readable } from 'stream';

// Access token OAuth yang fresh (di-refresh otomatis dari refresh_token).
// Dipakai untuk bikin resumable upload session.
async function getAccessToken(): Promise<string> {
  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_OAUTH_CLIENT_ID!,
    process.env.GOOGLE_OAUTH_CLIENT_SECRET!
  );
  oauth2.setCredentials({ refresh_token: process.env.GOOGLE_OAUTH_REFRESH_TOKEN! });
  const { token } = await oauth2.getAccessToken();
  if (!token) throw new Error('Gagal ambil access token Google (cek GOOGLE_OAUTH_REFRESH_TOKEN).');
  return token;
}

// Bikin resumable upload session di folder Drive tujuan, kembalikan session URI.
// Add-in lalu PUT byte GLB langsung ke URI ini (tanpa lewat server app -> hindari
// limit body 4.5MB Vercel). URI-nya sudah pre-authorized, tidak perlu token lagi.
export async function createResumableUpload(
  fileName: string,
  mimeType = 'model/gltf-binary'
): Promise<string> {
  const token = await getAccessToken();
  const metadata = { name: fileName, parents: [process.env.GOOGLE_DRIVE_FOLDER_ID!] };

  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': mimeType,
      },
      body: JSON.stringify(metadata),
    }
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gagal bikin upload session Drive (${res.status}): ${body}`);
  }
  const uploadUri = res.headers.get('location');
  if (!uploadUri) throw new Error('Drive tidak mengembalikan upload URI (header Location kosong).');
  return uploadUri;
}

// Stream file dari Drive (buat proxy /api/model/[versionId]). Node Readable.
export async function getDriveFileStream(fileId: string): Promise<Readable> {
  const drive = getDriveClient();
  const res = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'stream' }
  );
  return res.data as unknown as Readable;
}

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
