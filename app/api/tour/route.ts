import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { isAdminAuthed, adminPasswordConfigured } from '@/lib/adminAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Tur terpandu tersimpan untuk viewer presentasi.
//   GET  ?projectId&token       -> daftar pemberhentian (urut sort_order)
//   PUT  {projectId, token, stops} -> GANTI seluruh daftar (hapus lalu tulis)
//
// GET dijaga token client (sama seperti halaman presentasi). PUT juga wajib
// admin (cookie VIEWER_ADMIN_PASSWORD) — kalau password admin belum di-set,
// halaman memang terbuka, jadi ikut aturan yang sama dengan halaman Kelola.

interface StopRow {
  id?: string;
  title: string;
  description: string;
  mode: 'orbit' | 'walk' | 'plan';
  pose: { position: [number, number, number]; target: [number, number, number] };
  highlight: { gids?: string[]; categories?: string[] };
}

const MAX_STOPS = 60;
const MAX_GIDS = 3000;

async function gate(projectId: string | null, token: string | null) {
  if (!projectId || !token) return null;
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .eq('client_access_token', token)
    .maybeSingle();
  return data ? supabase : null;
}

export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get('projectId');
  const token = req.nextUrl.searchParams.get('token');
  const supabase = await gate(projectId, token);
  if (!supabase) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { data, error } = await supabase
    .from('tour_stops')
    .select('id, title, description, mode, pose, highlight, sort_order')
    .eq('project_id', projectId)
    .order('sort_order', { ascending: true });
  if (error) {
    // Tabel belum dibuat (schema.sql belum dijalankan) -> anggap kosong, jangan
    // bikin viewer error.
    return NextResponse.json({ stops: [], warning: error.message });
  }
  return NextResponse.json({ stops: data ?? [] });
}

function isVec3(v: unknown): v is [number, number, number] {
  return Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n));
}

function sanitize(raw: unknown, i: number): StopRow | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const pose = o.pose as Record<string, unknown> | undefined;
  if (!pose || !isVec3(pose.position) || !isVec3(pose.target)) return null;
  const title = typeof o.title === 'string' && o.title.trim() ? o.title.trim().slice(0, 120) : `Pemberhentian ${i + 1}`;
  const description = typeof o.description === 'string' ? o.description.slice(0, 2000) : '';
  const mode = o.mode === 'walk' || o.mode === 'plan' ? o.mode : 'orbit';
  const h = (o.highlight ?? {}) as Record<string, unknown>;
  const highlight: StopRow['highlight'] = {};
  if (Array.isArray(h.gids)) highlight.gids = h.gids.filter((g): g is string => typeof g === 'string').slice(0, MAX_GIDS);
  if (Array.isArray(h.categories)) highlight.categories = h.categories.filter((g): g is string => typeof g === 'string').slice(0, 200);
  return { title, description, mode, pose: { position: pose.position, target: pose.target }, highlight };
}

export async function PUT(req: NextRequest) {
  if (adminPasswordConfigured() && !(await isAdminAuthed())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  let body: { projectId?: string; token?: string; stops?: unknown[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Body JSON tidak valid' }, { status: 400 });
  }
  const supabase = await gate(body.projectId ?? null, body.token ?? null);
  if (!supabase) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!Array.isArray(body.stops)) return NextResponse.json({ error: 'stops wajib berupa array' }, { status: 400 });
  if (body.stops.length > MAX_STOPS) return NextResponse.json({ error: `Maksimum ${MAX_STOPS} pemberhentian` }, { status: 413 });

  const rows = body.stops
    .map((s, i) => sanitize(s, i))
    .filter((s): s is StopRow => Boolean(s))
    .map((s, i) => ({ project_id: body.projectId, sort_order: i, ...s }));

  const del = await supabase.from('tour_stops').delete().eq('project_id', body.projectId);
  if (del.error) return NextResponse.json({ error: del.error.message }, { status: 500 });
  if (rows.length > 0) {
    const ins = await supabase.from('tour_stops').insert(rows);
    if (ins.error) return NextResponse.json({ error: ins.error.message }, { status: 500 });
  }
  return NextResponse.json({ saved: rows.length });
}
