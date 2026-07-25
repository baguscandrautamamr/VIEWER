import { NextRequest, NextResponse } from 'next/server';
import { createResumableUpload } from '@/lib/googleDrive';
import { isAdminAuthed, adminPasswordConfigured } from '@/lib/adminAuth';

export const runtime = 'nodejs';

// Minta resumable upload session Google Drive. Dua pemakai:
//  - Add-in Revit: kirim header x-service-key == SUPABASE_SERVICE_ROLE_KEY.
//  - Halaman upload web (admin): butuh VIEWER_ADMIN_PASSWORD di-set + sudah login.
// Mencegah sembarang orang bikin upload ke Drive kamu.
export async function POST(req: NextRequest) {
  const key = req.headers.get('x-service-key');
  const viaServiceKey = !!key && key === process.env.SUPABASE_SERVICE_ROLE_KEY;
  const viaAdmin = adminPasswordConfigured() && (await isAdminAuthed());

  if (!viaServiceKey && !viaAdmin) {
    return NextResponse.json(
      { error: 'Unauthorized. Set VIEWER_ADMIN_PASSWORD & login untuk upload dari web.' },
      { status: 401 }
    );
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
