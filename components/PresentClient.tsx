'use client';

import { useState } from 'react';
import ModelViewer from './ModelViewer';
import type { Locale } from '@/lib/i18n';

export interface ModelFileOption {
  id: string;
  label: string;
}

// Bungkus ModelViewer + dropdown pilih model (kalau project punya >1 file GLB).
// Sumber model: file yang dipilih (/api/model-file/[id]); kalau tidak ada file
// sama sekali, pakai fallbackUrl (versi lama dari model_versions).
export default function PresentClient({
  projectId,
  files,
  fallbackUrl,
  locale = 'id',
}: {
  projectId: string;
  files: ModelFileOption[];
  fallbackUrl: string | null;
  locale?: Locale;
}) {
  const [selected, setSelected] = useState<string | null>(files[0]?.id ?? null);

  const url = selected ? `/api/model-file/${selected}` : fallbackUrl;

  if (!url) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm opacity-60">
        Belum ada model. Upload GLB lewat halaman Kelola.
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      {files.length > 1 && (
        <div className="absolute left-1/2 top-3 z-10 -translate-x-1/2">
          <select
            value={selected ?? ''}
            onChange={(e) => setSelected(e.target.value)}
            className="rounded border border-white/20 bg-black/60 px-2 py-1 text-xs text-white backdrop-blur"
          >
            {files.map((f) => (
              <option key={f.id} value={f.id} className="text-black">
                {f.label}
              </option>
            ))}
          </select>
        </div>
      )}
      {/* key: paksa ModelViewer re-init saat ganti file */}
      <ModelViewer key={url} projectId={projectId} initialGlbUrl={url} locale={locale} />
    </div>
  );
}
