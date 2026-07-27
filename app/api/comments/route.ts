import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { isAdminAuthed, adminPasswordConfigured } from '@/lib/adminAuth';

export const runtime = 'nodejs';

// Komentar/anotasi 3D per project. Baca terbuka (anon read policy juga ada,
// tapi kita lewatkan API supaya seragam), tulis lewat service role di sini —
// jadi client viewer bisa menaruh komentar tanpa perlu login admin.

// GET /api/comments?projectId=... -> daftar komentar (terbaru dulu).
export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get('projectId');
  if (!projectId) return NextResponse.json({ error: 'projectId wajib' }, { status: 400 });

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('comments')
    .select('id, author, body, pos_x, pos_y, pos_z, global_id, created_at')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ comments: data ?? [] });
}

// POST /api/comments  body: { projectId, body, author?, pos?, globalId? }
export async function POST(req: NextRequest) {
  let payload: {
    projectId?: string;
    body?: string;
    author?: string;
    pos?: { x: number; y: number; z: number } | null;
    globalId?: string | null;
  };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: 'Body JSON tidak valid' }, { status: 400 });
  }

  const projectId = payload.projectId?.trim();
  const body = payload.body?.trim();
  if (!projectId) return NextResponse.json({ error: 'projectId wajib' }, { status: 400 });
  if (!body) return NextResponse.json({ error: 'Isi komentar wajib' }, { status: 400 });

  const author = (payload.author ?? '').trim().slice(0, 80) || null;
  const pos = payload.pos ?? null;

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('comments')
    .insert({
      project_id: projectId,
      author,
      body: body.slice(0, 2000),
      pos_x: pos ? pos.x : null,
      pos_y: pos ? pos.y : null,
      pos_z: pos ? pos.z : null,
      global_id: payload.globalId ?? null,
    })
    .select('id, author, body, pos_x, pos_y, pos_z, global_id, created_at')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ comment: data });
}

// DELETE /api/comments?id=...  -> hapus komentar (admin only kalau password di-set).
export async function DELETE(req: NextRequest) {
  if (adminPasswordConfigured() && !(await isAdminAuthed())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id wajib' }, { status: 400 });

  const supabase = createServiceClient();
  const { error } = await supabase.from('comments').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
