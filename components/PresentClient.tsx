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

interface SheetStrings {
  title: string;
  show: string;
  hide: string;
  empty: string;
  selectHint: string;
}

// Panel presentasi: kiri viewer 3D (+ dropdown model), kanan sidebar sheet yang
// bisa dibuka/tutup. Sidebar berisi preview pane (sheet aktif) + daftar sheet
// gaya "detail view" (baris ringkas). Klik sheet -> pindah kamera 3D ke preset
// sheet itu (Fase 3a) sekaligus tampilkan PDF-nya di preview pane.
export default function PresentClient({
  projectId,
  files,
  fallbackUrl,
  locale = 'id',
  sheets,
  sheetStrings,
}: {
  projectId: string;
  files: ModelFileOption[];
  fallbackUrl: string | null;
  locale?: Locale;
  sheets: SheetItem[];
  sheetStrings: SheetStrings;
}) {
  const [selected, setSelected] = useState<string | null>(files[0]?.id ?? null);
  const [activeSheet, setActiveSheet] = useState<string | null>(null);
  // Bump counter tiap klik supaya klik sheet yang sama pun memicu re-apply.
  const [presetTick, setPresetTick] = useState(0);
  const [preset, setPreset] = useState<string | null>(null);
  // Sidebar default terbuka bila ada sheet.
  const [sidebarOpen, setSidebarOpen] = useState(sheets.length > 0);

  const url = selected ? `/api/model-file/${selected}` : fallbackUrl;
  const active = sheets.find((s) => s.id === activeSheet) ?? null;

  function onSheetClick(s: SheetItem) {
    setActiveSheet(s.id);
    setPreset(s.cameraPreset || 'iso');
    setPresetTick((n) => n + 1);
  }

  return (
    <div className="relative flex flex-1 gap-4 overflow-hidden">
      {/* Viewer 3D */}
      <div className="relative min-w-0 flex-1 rounded border border-foreground/15">
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

        {/* Tombol buka sidebar (muncul saat sidebar tertutup & ada sheet). */}
        {sheets.length > 0 && !sidebarOpen && (
          <button
            onClick={() => setSidebarOpen(true)}
            className="absolute right-3 top-3 z-10 rounded border border-foreground/20 bg-background/80 px-3 py-1.5 text-xs backdrop-blur transition-colors hover:border-foreground/40"
          >
            {sheetStrings.show} ({sheets.length})
          </button>
        )}
      </div>

      {/* Sidebar sheet (collapsible). */}
      {sheets.length > 0 && (
        <aside
          className={`flex shrink-0 flex-col overflow-hidden rounded transition-all duration-300 ${
            sidebarOpen ? 'w-72 border border-foreground/15 md:w-80' : 'w-0 border-0'
          }`}
        >
          <div className="flex items-center justify-between border-b border-foreground/10 p-3">
            <h2 className="text-sm font-medium opacity-70">
              {sheetStrings.title} ({sheets.length})
            </h2>
            <button
              onClick={() => setSidebarOpen(false)}
              className="rounded px-2 py-0.5 text-sm opacity-60 hover:opacity-100"
              aria-label={sheetStrings.hide}
              title={sheetStrings.hide}
            >
              ✕
            </button>
          </div>

          {/* Preview pane: hanya sheet yang sedang dipilih. */}
          <div className="border-b border-foreground/10 p-3">
            {active ? (
              <SheetViewer
                key={active.id}
                pdfUrl={`/api/sheet-file/${active.id}`}
                sheetName={active.title}
              />
            ) : (
              <p className="py-8 text-center text-xs opacity-50">
                {sheetStrings.selectHint}
              </p>
            )}
          </div>

          {/* Detail view: daftar sheet ringkas & rapi. */}
          <ul className="flex-1 divide-y divide-foreground/10 overflow-y-auto">
            {sheets.map((s) => (
              <li key={s.id}>
                <button
                  onClick={() => onSheetClick(s)}
                  className={`block w-full truncate px-3 py-2 text-left text-sm transition-colors ${
                    activeSheet === s.id
                      ? 'bg-accent/15 font-medium'
                      : 'hover:bg-foreground/5'
                  }`}
                  title={s.title}
                >
                  {s.title}
                </button>
              </li>
            ))}
          </ul>
        </aside>
      )}
    </div>
  );
}
