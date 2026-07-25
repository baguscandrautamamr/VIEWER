import { NextRequest, NextResponse } from 'next/server';
import { Readable } from 'stream';
import { createServiceClient } from '@/lib/supabase';
import { getDriveFileStream } from '@/lib/googleDrive';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Stream PDF sheet dari Drive berdasarkan sheets.id. Same-origin -> pdfjs aman.
// Fallback: kalau versi lama pakai pdf_storage_path (Supabase), redirect.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('sheets')
    .select('pdf_drive_file_id, pdf_storage_path')
    .eq('id', id)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: 'Sheet tidak ditemukan' }, { status: 404 });
  }
  if (!data.pdf_drive_file_id && data.pdf_storage_path) {
    return NextResponse.redirect(data.pdf_storage_path);
  }
  if (!data.pdf_drive_file_id) {
    return NextResponse.json({ error: 'Sheet tidak punya PDF' }, { status: 404 });
  }

  try {
    const nodeStream = await getDriveFileStream(data.pdf_drive_file_id);
    const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream;
    return new NextResponse(webStream, {
      headers: {
        'Content-Type': 'application/pdf',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Gagal mengambil PDF dari Drive';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
