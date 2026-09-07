'use client';

import { useMemo, useState } from 'react';

export interface TreeElement {
  globalId: string;
  name: string;
}
export interface TreeCategory {
  category: string;
  elements: TreeElement[];
}

export interface TreeStrings {
  title: string;
  search: string;
  empty: string;
  showAll: string;
  hideAll: string;
  checkAll: string;
  uncheckAll: string;
  isolate: string;
  count: string;
}

// Panel struktur model gaya Navisworks: dikelompokkan per kategori, tiap
// kategori bisa dibuka untuk melihat elemen di dalamnya. Checkbox = show/hide,
// klik nama = isolate + fokus. Semua aksi diteruskan ke ModelViewer lewat
// callback (ModelViewer yang pegang mesh Three.js).
export default function SelectionTree({
  categories,
  strings,
  hiddenCategories,
  hiddenIds,
  selectedId,
  onSelectElement,
  onSelectCategory,
  onToggleCategory,
  onToggleElement,
  onShowAll,
  onHideAll,
}: {
  categories: TreeCategory[];
  strings: TreeStrings;
  hiddenCategories: Set<string>;
  hiddenIds: Set<string>;
  selectedId: string | null;
  onSelectElement: (globalId: string) => void;
  onSelectCategory: (category: string) => void;
  onToggleCategory: (category: string, visible: boolean) => void;
  onToggleElement: (globalId: string, visible: boolean) => void;
  onShowAll: () => void;
  onHideAll: () => void;
}) {
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return categories;
    return categories
      .map((c) => ({
        category: c.category,
        elements: c.elements.filter(
          (e) =>
            e.name.toLowerCase().includes(q) ||
            e.globalId.toLowerCase().includes(q) ||
            c.category.toLowerCase().includes(q)
        ),
      }))
      .filter((c) => c.elements.length > 0 || c.category.toLowerCase().includes(q));
  }, [categories, query]);

  function toggleExpand(cat: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }

  return (
    <div className="flex h-full flex-col text-white">
      {/* Kepala panel. Dua tombol berpasangan: centang semua & kosongkan.
          "Kosongkan" dipakai untuk mengisolasi satu disiplin — sembunyikan
          semuanya dulu, lalu centang kategori yang ingin dilihat saja. */}
      <div className="border-b border-white/10 px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-sm font-medium">{strings.title}</span>
          <div className="flex shrink-0 items-center gap-1">
            <button
              onClick={onShowAll}
              className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] transition-colors hover:bg-white/20"
              title={strings.showAll}
            >
              ☑ {strings.checkAll}
            </button>
            <button
              onClick={onHideAll}
              className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] transition-colors hover:bg-white/20"
              title={strings.hideAll}
            >
              ☐ {strings.uncheckAll}
            </button>
          </div>
        </div>
      </div>

      <div className="p-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={strings.search}
          className="w-full rounded border border-white/15 bg-black/40 px-2 py-1 text-xs text-white placeholder:text-white/40 focus:border-white/40 focus:outline-none"
        />
      </div>

      {categories.length === 0 ? (
        <p className="px-3 py-6 text-center text-xs opacity-50">{strings.empty}</p>
      ) : (
        <ul className="flex-1 overflow-y-auto pb-2 text-xs">
          {filtered.map((cat) => {
            const isOpen = expanded.has(cat.category) || query.trim().length > 0;
            const catHidden = hiddenCategories.has(cat.category);
            return (
              <li key={cat.category}>
                <div className="flex items-center gap-1 px-2 py-1 hover:bg-white/5">
                  <input
                    type="checkbox"
                    checked={!catHidden}
                    onChange={(e) => onToggleCategory(cat.category, e.target.checked)}
                    className="h-3.5 w-3.5 shrink-0 accent-accent"
                    title={cat.category}
                  />
                  <button
                    onClick={() => toggleExpand(cat.category)}
                    className="w-4 shrink-0 text-white/50"
                    aria-label="expand"
                  >
                    {isOpen ? '▾' : '▸'}
                  </button>
                  <button
                    onClick={() => onSelectCategory(cat.category)}
                    className="flex-1 truncate text-left font-medium"
                    title={`${strings.isolate}: ${cat.category}`}
                  >
                    {cat.category}
                  </button>
                  <span className="shrink-0 text-[10px] opacity-40">
                    {cat.elements.length}
                  </span>
                </div>

                {isOpen && (
                  <ul>
                    {cat.elements.map((el) => {
                      const hidden = hiddenIds.has(el.globalId) || catHidden;
                      const isSel = selectedId === el.globalId;
                      return (
                        <li
                          key={el.globalId}
                          className={`flex items-center gap-1 py-0.5 pl-8 pr-2 hover:bg-white/5 ${
                            isSel ? 'bg-accent/20' : ''
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={!hidden}
                            onChange={(e) => onToggleElement(el.globalId, e.target.checked)}
                            className="h-3 w-3 shrink-0 accent-accent"
                          />
                          <button
                            onClick={() => onSelectElement(el.globalId)}
                            className="flex-1 truncate text-left opacity-90"
                            title={el.name || el.globalId}
                          >
                            {el.name || el.globalId}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
