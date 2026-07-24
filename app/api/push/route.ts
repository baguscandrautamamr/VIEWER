import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

// Dipanggil dari add-in C# setiap tombol "Export & Push" ditekan.
// Payload sudah berisi path file yang SUDAH diupload duluan ke Supabase
// Storage oleh add-in (route ini cuma catat metadata, bukan terima file
// mentah — upload file besar langsung dari add-in ke Storage API lebih
// efisien daripada lewat route ini).
interface PushPayload {
  projectId: string;
  glbStoragePath: string;
  rvtDriveFileId?: string;
  changedGlobalIds: string[];
  pushedBy?: string;
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as PushPayload;

  if (!body.projectId || !body.glbStoragePath) {
    return NextResponse.json(
      { error: 'projectId dan glbStoragePath wajib diisi' },
      { status: 400 }
    );
  }

  const supabase = createServiceClient();

  const { data: lastVersion } = await supabase
    .from('model_versions')
    .select('version_number')
    .eq('project_id', body.projectId)
    .order('version_number', { ascending: false })
    .limit(1)
    .single();

  const nextVersionNumber = (lastVersion?.version_number ?? 0) + 1;

  const { data, error } = await supabase
    .from('model_versions')
    .insert({
      project_id: body.projectId,
      version_number: nextVersionNumber,
      glb_storage_path: body.glbStoragePath,
      rvt_drive_file_id: body.rvtDriveFileId ?? null,
      changed_global_ids: body.changedGlobalIds ?? [],
      pushed_by: body.pushedBy ?? 'revit-addin',
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Insert ini otomatis trigger Supabase Realtime ke semua client yang
  // subscribe di lib/realtime.ts — tidak perlu broadcast manual.
  return NextResponse.json({ version: data });
}
