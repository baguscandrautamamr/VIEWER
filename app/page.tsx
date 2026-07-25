import Link from 'next/link';
import { createServiceClient } from '@/lib/supabase';
import { isAdminAuthed, adminPasswordConfigured } from '@/lib/adminAuth';
import AdminLogin from '@/components/AdminLogin';
import CopyLinkButton from '@/components/CopyLinkButton';

// Daftar project di-baca per-request (service role), jangan di-prerender.
export const dynamic = 'force-dynamic';

interface ProjectRow {
  id: string;
  name: string | null;
  client_access_token: string | null;
  created_at: string | null;
}

export default async function HomePage() {
  // Gate opsional: kalau VIEWER_ADMIN_PASSWORD di-set, minta login dulu.
  if (!(await isAdminAuthed())) {
    return <AdminLogin />;
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('projects')
    .select('id, name, client_access_token, created_at')
    .order('created_at', { ascending: false });

  const projects = (data ?? []) as ProjectRow[];

  return (
    <main className="mx-auto min-h-screen w-full max-w-3xl p-6">
      <header className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-lg font-medium">Revit Web Viewer</h1>
          <p className="text-sm opacity-60">Daftar project — klik untuk buka presentasi.</p>
        </div>
        {!adminPasswordConfigured() && (
          <span className="rounded bg-yellow-500/15 px-2 py-1 text-[11px] text-yellow-300">
            Halaman terbuka — set VIEWER_ADMIN_PASSWORD untuk mengunci
          </span>
        )}
      </header>

      {error && (
        <div className="rounded border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
          Gagal memuat daftar project: {error.message}
        </div>
      )}

      {!error && projects.length === 0 && (
        <div className="rounded border border-white/10 p-6 text-sm opacity-70">
          Belum ada project. Buat lewat tombol <b>Buat…</b> di add-in Revit
          (Pengaturan → Project ID), lalu klik Export &amp; Push.
        </div>
      )}

      <ul className="flex flex-col gap-2">
        {projects.map((p) => {
          const path = `/present/${p.id}?t=${encodeURIComponent(p.client_access_token ?? '')}`;
          return (
            <li
              key={p.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-white/10 p-4 hover:border-white/25"
            >
              <div className="min-w-0">
                <Link href={path} className="block truncate text-sm font-medium hover:underline">
                  {p.name || '(tanpa nama)'}
                </Link>
                <div className="truncate text-[11px] opacity-40">{p.id}</div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Link
                  href={`/manage/${p.id}`}
                  className="rounded border border-white/20 px-2 py-1 text-xs opacity-80 hover:opacity-100"
                >
                  Kelola
                </Link>
                <CopyLinkButton path={path} />
                <Link
                  href={path}
                  className="rounded bg-white px-3 py-1 text-xs font-medium text-black"
                >
                  Buka
                </Link>
              </div>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
