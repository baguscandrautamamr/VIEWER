import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { isAdminAuthed, adminPasswordConfigured } from '@/lib/adminAuth';

export const runtime = 'nodejs';

// Catat GLB yang sudah di-upload ke Drive sebagai 1 baris model_files.
// Admin only (butuh VIEWER_ADMIN_PASSWORD di-set + login).
export async function POST(req: NextRequest) {
  if (!(adminPasswordConfigured() && (await isAdminAuthed()))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let projectId = '';
  let driveFileId = '';
  let label = '';
  try {
    const body = await req.json();
    projectId = String(body?.projectId ?? '');
    driveFileId = String(body?.driveFileId ?? '');
    label = String(body?.label ?? '');
  } catch {
    /* ignore */
  }

  if (!projectId || !driveFileId) {
    return NextResponse.json({ error: 'projectId & driveFileId wajib' }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('model_files')
    .insert({ project_id: projectId, drive_file_id: driveFileId, label: label || null })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ file: data });
}

// Hapus 1 file model (admin). Query: ?id=<model_files.id>
export async function DELETE(req: NextRequest) {
  if (!(adminPasswordConfigured() && (await isAdminAuthed()))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id wajib' }, { status: 400 });

  const supabase = createServiceClient();
  const { error } = await supabase.from('model_files').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
