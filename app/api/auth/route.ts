import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

// Validasi token akses client untuk halaman /present/[projectId].
// TODO: putuskan dulu format token (query string vs PIN input terpisah,
// lihat REVIT-WEB-VIEWER-SETUP.md bagian 11) sebelum route ini dipakai
// beneran di Fase 1 — struktur di bawah ini masih asumsi awal.
export async function POST(req: NextRequest) {
  const { projectId, token } = await req.json();

  if (!projectId || !token) {
    return NextResponse.json({ valid: false }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { data } = await supabase
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .eq('client_access_token', token)
    .single();

  return NextResponse.json({ valid: !!data });
}
