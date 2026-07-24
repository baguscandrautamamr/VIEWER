// Root landing sederhana. Halaman inti ada di /present/[projectId]?t=token
// (client-facing) dan /admin/[projectId] (internal). Root ini sengaja tidak
// membocorkan daftar project — akses selalu lewat link ber-token.
export default function HomePage() {
  return (
    <main className="flex h-screen flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-lg font-medium">Revit Web Viewer</h1>
      <p className="max-w-md text-sm opacity-70">
        Presentasi 3D &amp; sheet dari Revit, sync real-time. Buka lewat link
        presentasi ber-token yang diberikan tim project.
      </p>
    </main>
  );
}
