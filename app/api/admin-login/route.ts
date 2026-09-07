import { NextRequest, NextResponse } from 'next/server';
import { adminPasswordConfigured, adminCookieValue, ADMIN_COOKIE } from '@/lib/adminAuth';

// Login admin sederhana. Kalau password cocok -> set cookie httpOnly.
export async function POST(req: NextRequest) {
  // Tidak ada password yang diset -> anggap sukses (halaman memang terbuka).
  if (!adminPasswordConfigured()) return NextResponse.json({ ok: true });

  let password = '';
  try {
    const body = await req.json();
    password = typeof body?.password === 'string' ? body.password : '';
  } catch {
    /* body tidak valid */
  }

  if (password !== process.env.VIEWER_ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Password salah' }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, adminCookieValue(), {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30, // 30 hari
  });
  return res;
}
