import { NextRequest, NextResponse } from 'next/server';
import { getRvtDownloadLink } from '@/lib/googleDrive';

// Dipanggil dari DownloadRvtButton. Service account credential tetap di
// server, client cuma dapat link hasil resolve.
export async function GET(req: NextRequest) {
  const fileId = req.nextUrl.searchParams.get('fileId');

  if (!fileId) {
    return NextResponse.json({ error: 'fileId wajib diisi' }, { status: 400 });
  }

  try {
    const link = await getRvtDownloadLink(fileId);
    return NextResponse.json(link);
  } catch (err) {
    return NextResponse.json({ error: 'Gagal ambil link Drive' }, { status: 500 });
  }
}
