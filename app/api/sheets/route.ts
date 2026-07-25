import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { isAdminAuthed, adminPasswordConfigured } from '@/lib/adminAuth';

export const runtime = 'nodejs';

// Ubah status tampil/sembunyi sheet ke client (halaman Kelola).
// Admin only. Body: { id, isVisible }.
export async function PATCH(req: NextRequest) {
  if (!(adminPasswordConfigured() && (await isAdminAuthed()))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let id = '';
  let isVisible = true;
  try {
    const body = await req.json();
    id = String(body?.id ?? '');
    isVisible = Boolean(body?.isVisible);
  } catch {
    /* ignore */
  }

  if (!id) return NextResponse.json({ error: 'id wajib' }, { status: 400 });

  const supabase = createServiceClient();
  const { error } = await supabase
    .from('sheets')
    .update({ is_visible: isVisible })
    .eq('id', id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
