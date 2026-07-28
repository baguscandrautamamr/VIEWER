import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { isAdminAuthed, adminPasswordConfigured } from '@/lib/adminAuth';

export const runtime = 'nodejs';

// Simpan nama & kategori elemen hasil impor IFC dari halaman Kelola.
//
// File IFC-nya sendiri TIDAK di-upload — parsing dilakukan di browser (lihat
// components/ImportElements.tsx), jadi yang sampai ke sini cuma daftar ringkas
// {guid, category, name}. Ini menghindari limit body Vercel sekaligus tidak
// membuang kuota untuk file ratusan MB yang datanya tidak dipakai.
//
// Client mengirim per batch; tiap request diperlakukan berdiri sendiri
// (upsert), sehingga aman diulang kalau ada batch yang gagal di tengah jalan.

interface IncomingRow {
  guid?: unknown;
  category?: unknown;
  name?: unknown;
}

const MAX_ROWS = 5000; // batas per request, sejalan dengan batch di client

export async function POST(req: NextRequest) {
  // Wajib admin — ini menulis data project. Kalau password admin belum di-set,
  // halaman Kelola memang terbuka, jadi ikut aturan yang sama.
  if (adminPasswordConfigured() && !(await isAdminAuthed())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let payload: { projectId?: string; rows?: IncomingRow[] };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: 'Body JSON tidak valid' }, { status: 400 });
  }

  const projectId = payload.projectId?.trim();
  if (!projectId) return NextResponse.json({ error: 'projectId wajib' }, { status: 400 });
  if (!Array.isArray(payload.rows)) {
    return NextResponse.json({ error: 'rows wajib berupa array' }, { status: 400 });
  }
  if (payload.rows.length > MAX_ROWS) {
    return NextResponse.json({ error: `Maksimum ${MAX_ROWS} baris per request` }, { status: 413 });
  }

  // Buang baris tanpa GlobalId — tanpa itu tidak ada yang bisa dicocokkan ke
  // objek di GLB, dan justru bikin baris sampah di tabel.
  const rows = payload.rows
    .filter((r) => typeof r.guid === 'string' && (r.guid as string).length > 0)
    .map((r) => ({
      project_id: projectId,
      global_id: r.guid as string,
      category: typeof r.category === 'string' ? r.category : null,
      name: typeof r.name === 'string' ? r.name : null,
    }));

  if (rows.length === 0) return NextResponse.json({ saved: 0 });

  const supabase = createServiceClient();
  const { error } = await supabase
    .from('elements')
    .upsert(rows, { onConflict: 'project_id,global_id' });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ saved: rows.length });
}
