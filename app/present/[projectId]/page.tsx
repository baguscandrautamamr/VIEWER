import { createServiceClient } from '@/lib/supabase';
import PresentClient, { type ModelFileOption } from '@/components/PresentClient';
import SheetViewer from '@/components/SheetViewer';
import VersionBadge from '@/components/VersionBadge';
import DownloadRvtButton from '@/components/DownloadRvtButton';

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
        <div className="max-w-sm rounded border border-white/10 p-6 text-center">
          <p className="text-sm opacity-80">
            Link presentasi tidak valid atau token akses salah.
          </p>
          <p className="mt-2 text-xs opacity-50">Minta ulang link akses ke tim project.</p>
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
        <div className="text-sm opacity-70">Belum ada model / sheet untuk project ini.</div>
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
        {latestVersion?.rvt_drive_file_id && (
          <DownloadRvtButton driveFileId={latestVersion.rvt_drive_file_id} />
        )}
      </div>

      <div className="grid flex-1 grid-cols-1 gap-4 overflow-hidden md:grid-cols-[2fr_1fr]">
        <div className="rounded border">
          <PresentClient projectId={projectId} files={files} fallbackUrl={fallbackUrl} />
        </div>

        <div className="overflow-y-auto rounded border p-3">
          <h2 className="mb-2 text-sm font-medium opacity-70">Sheet</h2>
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
