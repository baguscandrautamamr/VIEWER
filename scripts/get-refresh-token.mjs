// Ambil GOOGLE_OAUTH_REFRESH_TOKEN sekali jalan (untuk akun Google personal).
//
// Prasyarat:
//   1. Sudah buat OAuth Client ID tipe "Desktop app" di Google Cloud Console
//      (loopback redirect http://localhost otomatis diizinkan untuk tipe ini).
//   2. OAuth consent screen sudah di-PUBLISH ke "Production" — kalau masih
//      "Testing", refresh token expired dalam 7 hari.
//   3. Set env sebelum jalan:
//        export GOOGLE_OAUTH_CLIENT_ID=...
//        export GOOGLE_OAUTH_CLIENT_SECRET=...
//
// Jalankan:  node scripts/get-refresh-token.mjs
// Lalu copy baris GOOGLE_OAUTH_REFRESH_TOKEN=... ke .env.local

import http from 'node:http';
import { google } from 'googleapis';

const PORT = 5555;
const REDIRECT = `http://localhost:${PORT}/oauth2callback`;

const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  console.error(
    'Set dulu GOOGLE_OAUTH_CLIENT_ID & GOOGLE_OAUTH_CLIENT_SECRET di environment.'
  );
  process.exit(1);
}

const oauth2 = new google.auth.OAuth2(clientId, clientSecret, REDIRECT);

const authUrl = oauth2.generateAuthUrl({
  access_type: 'offline', // wajib supaya dapat refresh_token
  prompt: 'consent', // paksa Google kirim refresh_token walau sudah pernah izin
  scope: ['https://www.googleapis.com/auth/drive.file'],
});

const server = http.createServer(async (req, res) => {
  if (!req.url || !req.url.startsWith('/oauth2callback')) {
    res.writeHead(404).end();
    return;
  }

  const code = new URL(req.url, REDIRECT).searchParams.get('code');
  if (!code) {
    res.writeHead(400).end('Tidak ada code di callback.');
    return;
  }

  try {
    const { tokens } = await oauth2.getToken(code);
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Berhasil. Balik ke terminal — refresh token sudah dicetak.');

    if (!tokens.refresh_token) {
      console.error(
        '\nTidak dapat refresh_token. Biasanya karena app sudah pernah diizinkan.\n' +
          'Cabut akses di https://myaccount.google.com/permissions lalu ulangi.\n'
      );
    } else {
      console.log('\n=== Copy baris ini ke .env.local ===\n');
      console.log('GOOGLE_OAUTH_REFRESH_TOKEN=' + tokens.refresh_token + '\n');
    }
  } catch (err) {
    res.writeHead(500).end('Gagal tukar code jadi token.');
    console.error(err);
  } finally {
    server.close();
    setTimeout(() => process.exit(0), 200);
  }
});

server.listen(PORT, () => {
  console.log('\nBuka URL ini di browser, login akun Google kamu, lalu izinkan akses:\n');
  console.log(authUrl + '\n');
  console.log(`(menunggu callback di ${REDIRECT} ...)\n`);
});
