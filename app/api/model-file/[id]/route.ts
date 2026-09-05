import { NextRequest, NextResponse } from 'next/server';
import { Readable } from 'stream';
import { createServiceClient } from '@/lib/supabase';
import { getDriveFile } from '@/lib/googleDrive';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Stream GLB dari Drive berdasarkan model_files.id (dipilih dari dropdown viewer).
// Same-origin -> tidak ada masalah CORS di Three.js.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('model_files')
    .select('drive_file_id')
    .eq('id', id)
    .single();

  if (error || !data?.drive_file_id) {
    return NextResponse.json({ error: 'File model tidak ditemukan' }, { status: 404 });
  }

  try {
    const { stream: nodeStream, size } = await getDriveFile(data.drive_file_id);
    const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream;
    const headers: Record<string, string> = {
      'Content-Type': 'model/gltf-binary',
      'Cache-Control': 'public, max-age=31536000, immutable',
    };
    if (size) headers['Content-Length'] = String(size);
    return new NextResponse(webStream, { headers });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Gagal mengambil model dari Drive';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
