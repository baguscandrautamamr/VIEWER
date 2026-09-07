import { NextRequest, NextResponse } from 'next/server';
import { isAdminAuthed, adminPasswordConfigured } from '@/lib/adminAuth';

export const runtime = 'nodejs';

// Teruskan 1 potongan (chunk) file ke Google resumable session URI dari sisi
// server (browser tidak bisa PUT langsung ke Google -> CORS). Chunk dibatasi
// <=4MB oleh client biar di bawah limit body Vercel (4.5MB).
//
// Header dari client:
//   x-upload-uri     : session URI dari /api/drive/create-upload
//   x-content-range  : "bytes {start}-{end}/{total}"
// Body: byte chunk mentah.
export async function POST(req: NextRequest) {
  const key = req.headers.get('x-service-key');
  const viaServiceKey = !!key && key === process.env.SUPABASE_SERVICE_ROLE_KEY;
  const viaAdmin = adminPasswordConfigured() && (await isAdminAuthed());
  if (!viaServiceKey && !viaAdmin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const uploadUri = req.headers.get('x-upload-uri');
  const contentRange = req.headers.get('x-content-range');
  if (!uploadUri || !contentRange) {
    return NextResponse.json({ error: 'x-upload-uri & x-content-range wajib' }, { status: 400 });
  }

  const buf = Buffer.from(await req.arrayBuffer());

  const res = await fetch(uploadUri, {
    method: 'PUT',
    headers: {
      'Content-Range': contentRange,
      'Content-Length': String(buf.length),
    },
    body: buf,
    redirect: 'manual', // 308 = chunk diterima, lanjut (bukan redirect)
  });

  // 308 -> potongan diterima, masih ada lanjutannya.
  if (res.status === 308) {
    return NextResponse.json({ done: false });
  }

  // 200/201 -> upload selesai, body berisi metadata file (ada id).
  if (res.ok) {
    let id: string | null = null;
    try {
      id = (await res.json()).id ?? null;
    } catch {
      /* kadang body kosong; abaikan */
    }
    return NextResponse.json({ done: true, id });
  }

  const t = await res.text();
  return NextResponse.json(
    { error: `Chunk gagal (${res.status}): ${t.slice(0, 300)}` },
    { status: 500 }
  );
}
