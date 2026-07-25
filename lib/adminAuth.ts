import { cookies } from 'next/headers';
import crypto from 'crypto';

// Password admin OPSIONAL untuk halaman daftar project.
// - Kalau env VIEWER_ADMIN_PASSWORD di-set  -> halaman minta login dulu.
// - Kalau TIDAK di-set                       -> daftar project terbuka (tanpa login).
//
// Disarankan set VIEWER_ADMIN_PASSWORD di Vercel supaya daftar project +
// token client tidak bisa dilihat sembarang orang.

export function adminPasswordConfigured(): boolean {
  return !!(process.env.VIEWER_ADMIN_PASSWORD && process.env.VIEWER_ADMIN_PASSWORD.length > 0);
}

// Nilai cookie = hash dari password (password asli tidak pernah disimpan di cookie).
export function adminCookieValue(): string {
  const pw = process.env.VIEWER_ADMIN_PASSWORD ?? '';
  return crypto.createHash('sha256').update('rwv:' + pw).digest('hex');
}

export const ADMIN_COOKIE = 'rwv_admin';

export async function isAdminAuthed(): Promise<boolean> {
  if (!adminPasswordConfigured()) return true; // tidak ada password -> terbuka
  const jar = await cookies();
  return jar.get(ADMIN_COOKIE)?.value === adminCookieValue();
}
