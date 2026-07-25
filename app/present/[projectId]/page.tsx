import { createServiceClient } from '@/lib/supabase';
import { getLocale, getTheme, getStrings } from '@/lib/uiPrefs';
import PresentClient, { type ModelFileOption } from '@/components/PresentClient';
import SheetViewer from '@/components/SheetViewer';
import VersionBadge from '@/components/VersionBadge';
import DownloadRvtButton from '@/components/DownloadRvtButton';
import UiToggles from '@/components/UiToggles';

// Halaman ini selalu dinamis: baca versi terbaru & validasi token per-request,
// jangan di-prerender saat build (env Supabase belum tentu ada di build time).
export const dynamic = 'force-dynamic';

// Next 15: params & searchParams sekarang async (Promise), wajib di-await.
interface PresentPageProps {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ t?: string }>; // t = client access token (spec bagian 11)
}

export default async function PresentPage({ params, searchParams }: PresentPageProps) {
  const { projectId } = await params;
  const { t: token } = await searchParams;

  const [strings, locale, theme] = await Promise.all([getStrings(), getLocale(), getTheme()]);
  const supabase = createServiceClient();

  // Gate akses: token wajib cocok dengan projects.client_access_token.
  const { data: project } = await supabase
    .from('projects')
    .select('id, name')
    .eq('id', projectId)
    .eq('client_access_token', token ?? '')
    .single();

  if (!token || !project) {
    return (
      <main className="flex h-screen items-center justify-center p-6">
        <div className="max-w-sm rounded border border-foreground/10 p-6 text-center">
          <p className="text-sm opacity-80">{strings.access.invalidLink}</p>
          <p className="mt-2 text-xs opacity-50">{strings.access.askTeam}</p>
        </div>
      </main>
    );
  }

  // Pustaka model manual (Fase 1) + versi terbaru (fallback / badge / RVT).
  const { data: modelFiles } = await supabase
    .from('model_files')
    .select('id, label, drive_file_id, created_at')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false });

  const { data: latestVersion } = await supabase
    .from('model_versions')
    .select('*')
    .eq('project_id', projectId)
    .order('version_number', { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: sheets } = await supabase
    .from('sheets')
    .select('*')
    .eq('project_id', projectId);

  const files: ModelFileOption[] = (modelFiles ?? []).map((f) => ({
    id: f.id as string,
    label: (f.label as string) || 'Model',
  }));
  const fallbackUrl = latestVersion ? `/api/model/${latestVersion.id}` : null;

  const hasAnything = files.length > 0 || fallbackUrl || (sheets && sheets.length > 0);
  if (!hasAnything) {
    return (
      <main className="flex h-screen items-center justify-center p-6">
        <div className="text-sm opacity-70">{strings.access.empty}</div>
      </main>
    );
  }

  return (
    <main className="flex h-screen flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium">{project.name}</span>
          {latestVersion && (
            <VersionBadge
              versionNumber={latestVersion.version_number}
              pushedAt={latestVersion.pushed_at}
            />
          )}
        </div>
        <div className="flex items-center gap-3">
          {latestVersion?.rvt_drive_file_id && (
            <DownloadRvtButton driveFileId={latestVersion.rvt_drive_file_id} />
          )}
          <UiToggles locale={locale} theme={theme} />
        </div>
      </div>

      <div className="grid flex-1 grid-cols-1 gap-4 overflow-hidden md:grid-cols-[2fr_1fr]">
        <div className="rounded border border-foreground/15">
          <PresentClient
            projectId={projectId}
            files={files}
            fallbackUrl={fallbackUrl}
            locale={locale}
          />
        </div>

        <div className="overflow-y-auto rounded border border-foreground/15 p-3">
          <h2 className="mb-2 text-sm font-medium opacity-70">{strings.sheets.title}</h2>
          <div className="flex flex-col gap-4">
            {sheets?.map((sheet) => (
              <SheetViewer
                key={sheet.id}
                pdfUrl={sheet.pdf_storage_path}
                sheetName={`${sheet.sheet_number} — ${sheet.sheet_name ?? ''}`}
              />
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
