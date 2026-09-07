'use client';

import { useState } from 'react';
import type { Discipline } from '@/lib/showcase/disciplines';
import type { Style } from '@/lib/showcase/engine';
import type { TourStop } from '@/lib/showcase/types';
import { Eyebrow, Icons, Panel, RowButton, Toggle, tpl, type ShowcaseStrings } from './ui';

export interface Viewpoint {
  id: string;
  label: string;
  sub?: string;
}

// Panel kiri "Jelajahi model" (gaya Explore the plant di video).
export default function ExplorePanel({
  strings: s,
  elementCount,
  labels,
  onLabels,
  disciplines,
  highlightDisc,
  onHighlightDisc,
  highlightCount,
  planActive,
  onPlan,
  viewpoints,
  onViewpoint,
  style,
  onStyle,
  shadows,
  onShadows,
  autoRotate,
  onAutoRotate,
  onFind,
  onReset,
  onEntrance,
  onClearHighlight,
  onSnapshot,
}: {
  strings: ShowcaseStrings;
  elementCount: number;
  labels: boolean;
  onLabels: (v: boolean) => void;
  disciplines: { key: Discipline; label: string; count: number }[];
  highlightDisc: Discipline | null;
  onHighlightDisc: (d: Discipline | null) => void;
  highlightCount: number;
  planActive: boolean;
  onPlan: () => void;
  viewpoints: Viewpoint[];
  onViewpoint: (id: string) => void;
  style: Style;
  onStyle: (st: Style) => void;
  shadows: boolean;
  onShadows: (v: boolean) => void;
  autoRotate: boolean;
  onAutoRotate: (v: boolean) => void;
  onFind: () => void;
  onReset: () => void;
  onEntrance: () => void;
  onClearHighlight: () => void;
  onSnapshot: () => void;
  tour?: TourStop[];
}) {
  // Di layar sempit panel mulai tertutup supaya viewer tidak tertutup panel.
  const [open, setOpen] = useState(() => (typeof window === 'undefined' ? true : window.innerWidth >= 900));
  const [showViewpoints, setShowViewpoints] = useState(false);
  const [showDisc, setShowDisc] = useState(false);

  return (
    <Panel className="sc-explore">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between px-3 py-2.5">
        <Eyebrow>{s.explore}</Eyebrow>
        <span className="text-white/50">{open ? Icons.chevronUp : Icons.chevronDown}</span>
      </button>
      {open && (
        <div className="px-1.5 pb-2">
          <RowButton onClick={onFind} label={s.find} icon={Icons.search} trailing={<span className="sc-badge">{elementCount}</span>} />
          <div className="sc-sep" />
          <Toggle on={labels} onChange={onLabels} label={s.labels} icon={Icons.tag} />

          <RowButton
            onClick={() => setShowDisc((v) => !v)}
            label={s.highlightSystem}
            icon={Icons.pulse}
            active={highlightDisc !== null}
            trailing={highlightDisc ? <span className="sc-dot" /> : Icons.chevronDown}
          />
          {showDisc && (
            <div className="sc-sub">
              <button type="button" className={`sc-chip ${highlightDisc === null ? 'is-on' : ''}`} onClick={() => onHighlightDisc(null)}>
                {s.highlightNone}
              </button>
              {disciplines.map((d) => (
                <button
                  key={d.key}
                  type="button"
                  className={`sc-chip ${highlightDisc === d.key ? 'is-on' : ''}`}
                  onClick={() => onHighlightDisc(highlightDisc === d.key ? null : d.key)}
                >
                  {d.label} <span className="opacity-50">{d.count}</span>
                </button>
              ))}
              {highlightCount > 0 && <div className="mt-1 w-full text-[10.5px] text-white/45">{tpl(s.highlighted, { n: highlightCount })}</div>}
            </div>
          )}

          <RowButton onClick={onPlan} label={s.plan} icon={Icons.layers} active={planActive} trailing={Icons.arrowUpRight} />
          <RowButton
            onClick={() => setShowViewpoints((v) => !v)}
            label={s.viewpoints}
            icon={Icons.stairs}
            title={s.viewpointsHint}
            trailing={showViewpoints ? Icons.chevronUp : Icons.chevronDown}
          />
          {showViewpoints && (
            <div className="sc-sub flex-col items-stretch">
              {viewpoints.map((v) => (
                <button key={v.id} type="button" onClick={() => onViewpoint(v.id)} className="sc-result py-1">
                  <span className="min-w-0 flex-1 truncate text-[12px] text-white/85">{v.label}</span>
                  {v.sub && <span className="sc-mono text-white/35">{v.sub}</span>}
                  <span className="text-white/40">{Icons.arrowUpRight}</span>
                </button>
              ))}
            </div>
          )}

          <div className="sc-sep" />
          <RowButton
            onClick={() => onStyle(style === 'mono' ? 'original' : 'mono')}
            label={s.style}
            icon={Icons.palette}
            trailing={<span className="sc-mono text-white/50">{style === 'mono' ? s.styleMono : s.styleOriginal}</span>}
          />
          <Toggle on={shadows} onChange={onShadows} label={s.shadows} icon={Icons.sun} />
          <Toggle on={autoRotate} onChange={onAutoRotate} label={s.autoRotate} icon={Icons.rotate} />

          <div className="sc-sep" />
          <RowButton onClick={onReset} label={s.resetView} icon={Icons.reset} />
          <RowButton onClick={onEntrance} label={s.entrance} icon={Icons.home} />
          <RowButton onClick={onSnapshot} label={s.snapshot} icon={Icons.camera} />
          <div className="sc-sep" />
          <button type="button" onClick={onClearHighlight} className="sc-link mx-auto my-1">
            {Icons.x}
            {s.clearHighlight}
          </button>
        </div>
      )}
    </Panel>
  );
}
