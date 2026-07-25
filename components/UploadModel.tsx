'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

// Upload GLB: minta session ke app -> PUT byte langsung ke Google Drive
// (hindari limit body Vercel) -> catat sebagai model_files.
export default function UploadModel({ projectId }: { projectId: string }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [label, setLabel] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [pct, setPct] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function onUpload() {
    setErr('');
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setErr('Pilih file GLB dulu.');
      return;
    }
    setBusy(true);
    setPct(0);
    try {
      // 1) Minta resumable upload session dari app.
      setStatus('Menyiapkan upload…');
      const sess = await fetch('/api/drive/create-upload', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fileName: file.name }),
      });
      if (!sess.ok) throw new Error((await sess.json()).error || 'Gagal minta session');
      const { uploadUri } = await sess.json();

      // 2) Kirim file per-chunk lewat proxy app -> Google (hindari CORS + limit Vercel).
      setStatus('Meng-upload ke Google Drive…');
      const driveFileId = await uploadChunked(uploadUri, file, setPct);
      if (!driveFileId) throw new Error('Drive tidak mengembalikan file id.');

      // 3) Catat ke model_files.
      setStatus('Menyimpan…');
      const rec = await fetch('/api/model-files', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectId, driveFileId, label: label || file.name }),
      });
      if (!rec.ok) throw new Error((await rec.json()).error || 'Gagal menyimpan');

      setStatus('Selesai ✓');
      setLabel('');
      if (fileRef.current) fileRef.current.value = '';
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Upload gagal');
      setStatus(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-white/10 p-4">
      <h2 className="mb-3 text-sm font-medium">Upload model GLB</h2>
      <input
        ref={fileRef}
        type="file"
        accept=".glb,model/gltf-binary"
        className="block w-full text-xs file:mr-3 file:rounded file:border-0 file:bg-white file:px-3 file:py-1.5 file:text-black"
      />
      <input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="Label (opsional, mis. Lantai 1 Electrical)"
        className="mt-3 w-full rounded border border-white/20 bg-transparent px-3 py-2 text-sm outline-none focus:border-white/50"
      />
      <button
        onClick={onUpload}
        disabled={busy}
        className="mt-3 rounded bg-white px-4 py-2 text-sm font-medium text-black disabled:opacity-50"
      >
        {busy ? 'Meng-upload…' : 'Upload'}
      </button>

      {busy && (
        <div className="mt-3">
          <div className="h-2 w-full overflow-hidden rounded bg-white/10">
            <div className="h-full bg-white transition-all" style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-1 text-xs opacity-60">{status} {pct > 0 && `${pct}%`}</p>
        </div>
      )}
      {!busy && status && <p className="mt-2 text-xs opacity-70">{status}</p>}
      {err && <p className="mt-2 text-xs text-red-400">{err}</p>}
    </div>
  );
}

// Upload file per-chunk lewat proxy app (/api/drive/upload-chunk) -> Google.
// Chunk 4MB (kelipatan 256KB, syarat resumable Google) & < limit Vercel.
// Return Drive file id.
async function uploadChunked(
  uploadUri: string,
  file: File,
  onProgress: (pct: number) => void
): Promise<string | null> {
  const CHUNK = 4 * 1024 * 1024; // 4MB
  const total = file.size;
  let start = 0;
  let id: string | null = null;

  while (start < total) {
    const end = Math.min(start + CHUNK, total);
    const chunk = file.slice(start, end);
    const range = `bytes ${start}-${end - 1}/${total}`;

    const res = await fetch('/api/drive/upload-chunk', {
      method: 'POST',
      headers: { 'x-upload-uri': uploadUri, 'x-content-range': range },
      body: chunk,
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error || `Chunk gagal (${res.status})`);
    if (j.done && j.id) id = j.id;

    start = end;
    onProgress(Math.round((end / total) * 100));
  }
  return id;
}
