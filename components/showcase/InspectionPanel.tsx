'use client';

import type { ElementInfo } from '@/lib/showcase/types';
import { CloseButton, Eyebrow, Icons, Panel, tpl, type ShowcaseStrings } from './ui';

function m(v: number) {
  return `${v.toFixed(v >= 10 ? 1 : 2)} m`;
}

// Panel kanan "Inspeksi elemen" (gaya Equipment inspection di video):
// nama, kategori, GlobalId sebagai "tag", dimensi, fungsi (AI), elemen sejenis
// & sekitar, tombol aksi.
export default function InspectionPanel({
  element,
  groundY,
  sameName,
  nearby,
  strings: s,
  aiEnabled,
  explanation,
  explaining,
  disciplineLabel,
  onExplain,
  onGoto,
  onHighlightSimilar,
  onAsk,
  onSelect,
  onClose,
}: {
  element: ElementInfo;
  groundY: number;
  sameName: ElementInfo[];
  nearby: ElementInfo[];
  strings: ShowcaseStrings;
  aiEnabled: boolean;
  explanation: string | null;
  explaining: boolean;
  disciplineLabel: string;
  onExplain: () => void;
  onGoto: () => void;
  onHighlightSimilar: () => void;
  onAsk: () => void;
  onSelect: (gid: string) => void;
  onClose: () => void;
}) {
  const e = element;
  const unmapped = e.gid.startsWith('unmapped:');
  return (
    <Panel className="sc-side">
      <div className="flex items-start justify-between gap-2">
        <Eyebrow>{s.inspectTitle}</Eyebrow>
        <CloseButton onClick={onClose} />
      </div>
      <h2 className="mt-1 text-[17px] font-semibold leading-snug text-white">{e.name}</h2>
      <p className="mt-0.5 text-[11.5px] text-white/55">
        {e.categoryLabel} · {disciplineLabel}
      </p>

      <div className="sc-tag mt-3">
        <Eyebrow>{s.inspectId}</Eyebrow>
        <div className="sc-mono mt-1 break-all text-[12px] text-[color:var(--sc-accent)]">{unmapped ? '—' : e.gid}</div>
        {e.rawName && e.rawName !== e.name && <div className="mt-1 text-[10.5px] text-white/45">{e.rawName}</div>}
      </div>

      <div className="mt-3">
        <Eyebrow>{s.inspectDims}</Eyebrow>
        <div className="sc-dims mt-1">
          <div>
            <span>{s.inspectLength}</span>
            <b>{m(e.size[0])}</b>
          </div>
          <div>
            <span>{s.inspectWidth}</span>
            <b>{m(e.size[2])}</b>
          </div>
          <div>
            <span>{s.inspectHeight}</span>
            <b>{m(e.size[1])}</b>
          </div>
          <div>
            <span>{s.inspectElevation}</span>
            <b>+{m(e.min[1] - groundY)}</b>
          </div>
        </div>
        <p className="mt-1 text-[10.5px] text-white/40">{s.inspectNote}</p>
      </div>

      <div className="mt-3">
        <Eyebrow className="flex items-center gap-1.5">
          {s.inspectFunction}
          {aiEnabled && <span className="text-[color:var(--sc-accent)]">{Icons.spark}</span>}
        </Eyebrow>
        {explanation ? (
          <p className="mt-1 whitespace-pre-wrap text-[12.5px] leading-relaxed text-white/80">{explanation}</p>
        ) : aiEnabled ? (
          <button type="button" onClick={onExplain} disabled={explaining} className="sc-btn mt-1 w-full">
            {Icons.spark}
            {explaining ? s.inspectAiBusy : s.inspectAiExplain}
          </button>
        ) : (
          <p className="mt-1 text-[11.5px] text-white/45">{s.aiOffline}</p>
        )}
      </div>

      {sameName.length > 1 && (
        <div className="mt-3">
          <Eyebrow>{s.inspectRelated}</Eyebrow>
          <p className="mt-0.5 text-[12px] text-white/70">{tpl(s.inspectSameFamily, { n: sameName.length })}</p>
        </div>
      )}

      {nearby.length > 0 && (
        <div className="mt-3">
          <Eyebrow>{s.inspectNearby}</Eyebrow>
          <ul className="mt-1">
            {nearby.map((n) => (
              <li key={n.gid}>
                <button type="button" onClick={() => onSelect(n.gid)} className="sc-result py-1">
                  <span className="min-w-0 flex-1 truncate text-[12px] text-white/80">{n.name}</span>
                  <span className="sc-mono text-white/35">{n.categoryLabel}</span>
                  <span className="text-white/40">{Icons.arrowUpRight}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-4 flex flex-col gap-1.5">
        <button type="button" onClick={onGoto} className="sc-btn sc-btn-primary w-full">
          {Icons.pin}
          {s.inspectGoto}
        </button>
        <button type="button" onClick={onHighlightSimilar} className="sc-btn w-full">
          {Icons.layers}
          {s.inspectHighlightSimilar}
        </button>
        {aiEnabled && (
          <button type="button" onClick={onAsk} className="sc-btn w-full">
            {Icons.spark}
            {s.inspectAsk}
          </button>
        )}
      </div>
    </Panel>
  );
}
