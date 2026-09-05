'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { searchElements } from '@/lib/showcase/search';
import type { ElementInfo } from '@/lib/showcase/types';
import { CloseButton, Icons, Panel, tpl, type ShowcaseStrings } from './ui';

const PAGE = 120;

// Modal "Navigator elemen" (gaya Equipment navigator di video): kolom cari,
// hasil dikelompokkan per kategori, klik -> pilih + kamera terbang.
export default function EquipmentNavigator({
  elements,
  strings: s,
  initialQuery = '',
  onPick,
  onClose,
}: {
  elements: ElementInfo[];
  strings: ShowcaseStrings;
  initialQuery?: string;
  onPick: (gid: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [cat, setCat] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => setLimit(PAGE), [query, cat]);

  const categories = useMemo(() => {
    const m = new Map<string, { label: string; count: number }>();
    for (const e of elements) {
      const cur = m.get(e.category);
      if (cur) cur.count++;
      else m.set(e.category, { label: e.categoryLabel, count: 1 });
    }
    return Array.from(m.entries())
      .map(([category, v]) => ({ category, ...v }))
      .sort((a, b) => b.count - a.count);
  }, [elements]);

  const results = useMemo(() => {
    const q = query.trim();
    let list: ElementInfo[];
    if (q) list = searchElements(elements, q, 2000).map((h) => h.element);
    else list = elements.slice().sort((a, b) => b.radius - a.radius);
    if (cat) list = list.filter((e) => e.category === cat);
    return list;
  }, [elements, query, cat]);

  // Kelompokkan per kategori, pertahankan urutan skor.
  const grouped = useMemo(() => {
    const groups: { label: string; items: ElementInfo[] }[] = [];
    const idx = new Map<string, number>();
    for (const e of results.slice(0, limit)) {
      let gi = idx.get(e.category);
      if (gi === undefined) {
        gi = groups.length;
        idx.set(e.category, gi);
        groups.push({ label: e.categoryLabel, items: [] });
      }
      groups[gi].items.push(e);
    }
    return groups;
  }, [results, limit]);

  return (
    <div className="sc-modal-backdrop" onClick={onClose}>
      <Panel className="sc-modal" style={{ width: 'min(520px, 92vw)' }}>
        <div onClick={(e) => e.stopPropagation()}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-[15px] font-semibold text-white">{s.navTitle}</h2>
              <p className="mt-0.5 text-[11.5px] text-white/55">{s.navHint}</p>
            </div>
            <CloseButton onClick={onClose} />
          </div>
          <label className="sc-search mt-3">
            <span className="text-white/50">{Icons.search}</span>
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={s.navSearch}
              onKeyDown={(e) => {
                if (e.key === 'Escape') onClose();
                if (e.key === 'Enter' && results[0]) onPick(results[0].gid);
              }}
            />
            <span className="sc-mono text-white/40">{tpl(s.navCount, { n: results.length })}</span>
          </label>
          <div className="sc-chips mt-2">
            <button type="button" className={`sc-chip ${cat === null ? 'is-on' : ''}`} onClick={() => setCat(null)}>
              {s.navAll}
            </button>
            {categories.slice(0, 14).map((c) => (
              <button
                key={c.category}
                type="button"
                className={`sc-chip ${cat === c.category ? 'is-on' : ''}`}
                onClick={() => setCat(cat === c.category ? null : c.category)}
                title={c.category}
              >
                {c.label} <span className="opacity-50">{c.count}</span>
              </button>
            ))}
          </div>
          <div className="sc-scroll mt-2" style={{ maxHeight: '52vh' }}>
            {grouped.length === 0 && <p className="py-8 text-center text-[12px] text-white/50">{s.navEmpty}</p>}
            {grouped.map((g) => (
              <div key={g.label} className="mb-2">
                <div className="sc-eyebrow px-2 pt-2">{g.label}</div>
                {g.items.map((e) => (
                  <button key={e.gid} type="button" onClick={() => onPick(e.gid)} className="sc-result">
                    <span className="text-white/40">{Icons.pin}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] text-white/90">{e.name}</span>
                      <span className="sc-mono block truncate text-white/40">
                        {e.gid.startsWith('unmapped:') ? '—' : e.gid} · {e.size[0].toFixed(1)}×{e.size[2].toFixed(1)}×{e.size[1].toFixed(1)} m
                      </span>
                    </span>
                    <span className="text-white/40">{Icons.arrowUpRight}</span>
                  </button>
                ))}
              </div>
            ))}
            {results.length > limit && (
              <button type="button" onClick={() => setLimit((l) => l + PAGE)} className="sc-link mx-auto my-2">
                {s.navShowMore} ({results.length - limit})
              </button>
            )}
          </div>
        </div>
      </Panel>
    </div>
  );
}
