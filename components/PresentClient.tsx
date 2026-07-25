'use client';

import { useState } from 'react';
import ModelViewer from './ModelViewer';
import SheetViewer from './SheetViewer';
import type { Locale } from '@/lib/i18n';

export interface ModelFileOption {
  id: string;
  label: string;
}

export interface SheetItem {
  id: string;
  title: string;
  cameraPreset: string | null;
}

// Panel presentasi: kiri viewer 3D (+ dropdown model), kanan daftar sheet.
// Klik sheet -> pindahkan kamera 3D ke preset sheet itu (Fase 3a).
export default function PresentClient({
  projectId,
  files,
  fallbackUrl,
  locale = 'id',
  sheets,
  sheetsTitle,
}: {
  projectId: string;
  files: ModelFileOption[];
  fallbackUrl: string | null;
  locale?: Locale;
  sheets: SheetItem[];
  sheetsTitle: string;
}) {
  const [selected, setSelected] = useState<string | null>(files[0]?.id ?? null);
  const [activeSheet, setActiveSheet] = useState<string | null>(null);
  // Bump counter tiap klik supaya klik sheet yang sama pun memicu re-apply.
  const [presetTick, setPresetTick] = useState(0);
  const [preset, setPreset] = useState<string | null>(null);

  const url = selected ? `/api/model-file/${selected}` : fallbackUrl;

  function onSheetClick(s: SheetItem) {
    setActiveSheet(s.id);
    setPreset(s.cameraPreset || 'iso');
    setPresetTick((n) => n + 1);
  }

  return (
    <div className="grid flex-1 grid-cols-1 gap-4 overflow-hidden md:grid-cols-[2fr_1fr]">
      <div className="relative rounded border border-foreground/15">
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
        {url ? (
          <ModelViewer
            key={url}
            projectId={projectId}
            initialGlbUrl={url}
            locale={locale}
            cameraPreset={preset ? `${preset}#${presetTick}` : null}
          />
        ) : (
          <div className="flex h-full items-center justify-center p-6 text-sm opacity-60">
            —
          </div>
        )}
      </div>

      <div className="overflow-y-auto rounded border border-foreground/15 p-3">
        <h2 className="mb-2 text-sm font-medium opacity-70">{sheetsTitle}</h2>
        <div className="flex flex-col gap-4">
          {sheets.map((s) => (
            <button
              key={s.id}
              onClick={() => onSheetClick(s)}
              className={`flex flex-col gap-2 rounded border p-2 text-left transition-colors ${
                activeSheet === s.id
                  ? 'border-accent'
                  : 'border-foreground/10 hover:border-foreground/30'
              }`}
            >
              <div className="text-sm font-medium">{s.title}</div>
              <SheetViewer pdfUrl={`/api/sheet-file/${s.id}`} />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
