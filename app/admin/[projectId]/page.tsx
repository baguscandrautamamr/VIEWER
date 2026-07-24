import { createServiceClient } from '@/lib/supabase';

// Selalu dinamis: baca data project per-request, jangan di-prerender saat build.
export const dynamic = 'force-dynamic';

// Next 15: params sekarang async (Promise), wajib di-await.
interface AdminPageProps {
  params: Promise<{ projectId: string }>;
}

// Halaman internal (bukan client-facing) — history semua push dan link
// akses presentasi. Tambahkan auth kamu sendiri di sini sebelum dipakai
// beneran (belum ada di skeleton ini, hanya read-only listing).
export default async function AdminPage({ params }: AdminPageProps) {
  const { projectId } = await params;
  const supabase = createServiceClient();

  const { data: project } = await supabase
    .from('projects')
    .select('*')
    .eq('id', projectId)
    .single();

  const { data: versions } = await supabase
    .from('model_versions')
    .select('*')
    .eq('project_id', projectId)
    .order('version_number', { ascending: false });

  if (!project) {
    return <div className="p-6">Project tidak ditemukan.</div>;
  }

  const presentUrl = `/present/${projectId}?t=${project.client_access_token}`;

  return (
    <main className="flex flex-col gap-4 p-6">
      <h1 className="text-lg font-medium">{project.name}</h1>

      <div className="rounded border p-3 text-sm">
        Link presentasi client:{' '}
        <code className="rounded bg-black/20 px-2 py-1">{presentUrl}</code>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-medium opacity-70">History Push</h2>
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b opacity-70">
              <th className="py-1">Versi</th>
              <th>Waktu</th>
              <th>Elemen Berubah</th>
            </tr>
          </thead>
          <tbody>
            {versions?.map((v) => (
              <tr key={v.id} className="border-b border-white/10">
                <td className="py-1">v{v.version_number}</td>
                <td>{new Date(v.pushed_at).toLocaleString('id-ID')}</td>
                <td>{v.changed_global_ids?.length ?? 0} elemen</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
