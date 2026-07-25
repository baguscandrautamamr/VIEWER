import { NextRequest, NextResponse } from 'next/server';
import { createResumableUpload } from '@/lib/googleDrive';

export const runtime = 'nodejs';

// Dipanggil add-in Revit untuk minta resumable upload session Google Drive.
// Auth: header x-service-key harus == SUPABASE_SERVICE_ROLE_KEY (add-in sudah
// memegang key ini). Ini mencegah sembarang orang bikin upload ke Drive kamu.
export async function POST(req: NextRequest) {
  const key = req.headers.get('x-service-key');
  if (!key || key !== process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let fileName = '';
  try {
    const body = await req.json();
    fileName = typeof body?.fileName === 'string' ? body.fileName : '';
  } catch {
    /* ignore */
  }
  if (!fileName) {
    return NextResponse.json({ error: 'fileName wajib diisi' }, { status: 400 });
  }

  try {
    const uploadUri = await createResumableUpload(fileName);
    return NextResponse.json({ uploadUri });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Gagal bikin upload session';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
