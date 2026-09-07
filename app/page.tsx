import Link from 'next/link';
import { createServiceClient } from '@/lib/supabase';
import { isAdminAuthed, adminPasswordConfigured } from '@/lib/adminAuth';
import { getLocale, getTheme, getStrings } from '@/lib/uiPrefs';
import AdminLogin from '@/components/AdminLogin';
import CopyLinkButton from '@/components/CopyLinkButton';
import DeleteProjectButton from '@/components/DeleteProjectButton';
import UiToggles from '@/components/UiToggles';

export const dynamic = 'force-dynamic';

interface ProjectRow {
  id: string;
  name: string | null;
  client_access_token: string | null;
  created_at: string | null;
}

export default async function HomePage() {
  const [t, locale, theme] = await Promise.all([getStrings(), getLocale(), getTheme()]);

  if (!(await isAdminAuthed())) {
    return <AdminLogin t={t.login} />;
  }

  const canDelete = adminPasswordConfigured();

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('projects')
    .select('id, name, client_access_token, created_at')
    .order('created_at', { ascending: false });

  const projects = (data ?? []) as ProjectRow[];

  return (
    <main className="mx-auto min-h-screen w-full max-w-3xl p-6">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-medium">
            <Logo /> {t.home.title}
          </h1>
          <p className="text-sm opacity-60">{t.home.subtitle}</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <UiToggles locale={locale} theme={theme} />
          {!canDelete && (
            <span className="rounded bg-yellow-500/15 px-2 py-1 text-[11px] text-yellow-500">
              {t.home.openWarning}
            </span>
          )}
        </div>
      </header>

      {error && (
        <div className="rounded border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-400">
          {error.message}
        </div>
      )}

      {!error && projects.length === 0 && (
        <div className="rounded-lg border border-foreground/10 p-6 text-sm opacity-70">
          {t.home.noProjects}
        </div>
      )}

      <ul className="flex flex-col gap-2">
        {projects.map((p) => {
          const path = `/present/${p.id}?t=${encodeURIComponent(p.client_access_token ?? '')}`;
          return (
            <li
              key={p.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-foreground/10 p-4 hover:border-foreground/25"
            >
              <div className="min-w-0">
                <Link href={path} className="block truncate text-sm font-medium hover:underline">
                  {p.name || '(tanpa nama)'}
                </Link>
                <div className="truncate text-[11px] opacity-40">{p.id}</div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {canDelete && (
                  <DeleteProjectButton
                    id={p.id}
                    name={p.name || p.id}
                    confirmText={t.home.confirmDelete}
                    label={t.home.delete}
                  />
                )}
                <Link
                  href={`/manage/${p.id}`}
                  className="rounded border border-foreground/20 px-2 py-1 text-xs opacity-80 hover:opacity-100"
                >
                  {t.home.manage}
                </Link>
                <CopyLinkButton path={path} label={t.home.copyLink} copiedLabel={t.home.copied} />
                <Link
                  href={path}
                  className="rounded bg-foreground px-3 py-1 text-xs font-medium text-background"
                >
                  {t.home.open}
                </Link>
              </div>
            </li>
          );
        })}
      </ul>
    </main>
  );
}

function Logo() {
  return (
    <svg viewBox="0 0 64 64" width="20" height="20" aria-hidden>
      <g fill="none" stroke="#ffc107" strokeWidth="4" strokeLinejoin="round" strokeLinecap="round">
        <path d="M32 12 L52 23 L52 41 L32 52 L12 41 L12 23 Z" />
        <path d="M32 12 L32 32 M12 23 L32 32 L52 23" />
      </g>
    </svg>
  );
}
