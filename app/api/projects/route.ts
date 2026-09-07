import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { isAdminAuthed, adminPasswordConfigured } from '@/lib/adminAuth';

export const runtime = 'nodejs';

// Hapus project (cascade: model_versions, sheets, elements, model_files ikut
// terhapus lewat ON DELETE CASCADE). Wajib admin (password di-set + login) —
// aksi destruktif tidak boleh terbuka.
export async function DELETE(req: NextRequest) {
  if (!(adminPasswordConfigured() && (await isAdminAuthed()))) {
    return NextResponse.json(
      { error: 'Unauthorized. Set VIEWER_ADMIN_PASSWORD & login dulu.' },
      { status: 401 }
    );
  }

  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id wajib' }, { status: 400 });

  const supabase = createServiceClient();
  const { error } = await supabase.from('projects').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
