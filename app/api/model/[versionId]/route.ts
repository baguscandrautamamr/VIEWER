import { NextRequest, NextResponse } from 'next/server';
import { Readable } from 'stream';
import { createServiceClient } from '@/lib/supabase';
import { getDriveFileStream } from '@/lib/googleDrive';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Proxy model GLB untuk viewer. Same-origin (tidak ada masalah CORS).
// - Kalau versi punya glb_drive_file_id -> stream dari Google Drive.
// - Kalau cuma punya glb_storage_path (cara lama) -> redirect ke URL Supabase.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ versionId: string }> }
) {
  const { versionId } = await params;

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('model_versions')
    .select('glb_drive_file_id, glb_storage_path')
    .eq('id', versionId)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: 'Versi model tidak ditemukan' }, { status: 404 });
  }

  // Cara lama: file ada di Supabase Storage -> redirect saja.
  if (!data.glb_drive_file_id && data.glb_storage_path) {
    return NextResponse.redirect(data.glb_storage_path);
  }

  if (!data.glb_drive_file_id) {
    return NextResponse.json({ error: 'Versi model tidak punya file' }, { status: 404 });
  }

  try {
    const nodeStream = await getDriveFileStream(data.glb_drive_file_id);
    const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream;
    return new NextResponse(webStream, {
      headers: {
        'Content-Type': 'model/gltf-binary',
        // GLB per-versi bersifat immutable -> boleh di-cache lama.
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Gagal mengambil model dari Drive';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
