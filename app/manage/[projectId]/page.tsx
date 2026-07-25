import Link from 'next/link';
import { createServiceClient } from '@/lib/supabase';
import { isAdminAuthed, adminPasswordConfigured } from '@/lib/adminAuth';
import { getLocale, getTheme, getStrings } from '@/lib/uiPrefs';
import AdminLogin from '@/components/AdminLogin';
import UploadModel from '@/components/UploadModel';
import DeleteModelFileButton from '@/components/DeleteModelFileButton';
import UiToggles from '@/components/UiToggles';

export const dynamic = 'force-dynamic';

interface ModelFileRow {
  id: string;
  drive_file_id: string;
  label: string | null;
  created_at: string | null;
}

export default async function ManagePage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const [t, locale, theme] = await Promise.all([getStrings(), getLocale(), getTheme()]);

  if (!adminPasswordConfigured()) {
    return (
      <main className="mx-auto max-w-lg p-6">
        <h1 className="mb-2 text-lg font-medium">{t.manage.title}</h1>
        <p className="rounded border border-yellow-500/30 bg-yellow-500/10 p-4 text-sm text-yellow-500">
          {t.manage.needPassword}
        </p>
      </main>
    );
  }
  if (!(await isAdminAuthed())) {
    return <AdminLogin t={t.login} />;
  }

  const supabase = createServiceClient();
  const { data: project } = await supabase
    .from('projects')
    .select('id, name')
    .eq('id', projectId)
    .single();

  const { data: files } = await supabase
    .from('model_files')
    .select('id, drive_file_id, label, created_at')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false });

  const list = (files ?? []) as ModelFileRow[];

  return (
    <main className="mx-auto max-w-2xl p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-medium">{t.manage.title}</h1>
          <p className="text-sm opacity-60">{project?.name ?? projectId}</p>
        </div>
        <div className="flex items-center gap-3">
          <UiToggles locale={locale} theme={theme} />
          <Link href="/" className="text-xs opacity-70 hover:opacity-100">
            {t.manage.backToList}
          </Link>
        </div>
      </div>

      <UploadModel
        projectId={projectId}
        strings={{ title: t.manage.uploadTitle, label: t.manage.label, upload: t.manage.upload, uploading: t.manage.uploading }}
      />

      <h2 className="mb-2 mt-6 text-sm font-medium opacity-70">
        {t.manage.fileList} ({list.length})
      </h2>
      {list.length === 0 ? (
        <p className="rounded border border-foreground/10 p-4 text-sm opacity-60">
          {t.manage.empty}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {list.map((f) => (
            <li
              key={f.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-foreground/10 p-3"
            >
              <div className="min-w-0">
                <div className="truncate text-sm">{f.label || f.drive_file_id}</div>
                <div className="truncate text-[11px] opacity-40">
                  {f.created_at ? new Date(f.created_at).toLocaleString() : ''}
                </div>
              </div>
              <DeleteModelFileButton
                id={f.id}
                label={t.manage.deleteFile}
                confirmText={t.manage.confirmDeleteFile}
              />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
