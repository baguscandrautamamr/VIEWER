'use client';

import { useState } from 'react';

export interface ManageSheet {
  id: string;
  title: string;
  isVisible: boolean;
}

// Daftar sheet dengan checkbox: centang = tampil ke client. Toggle langsung
// simpan ke server (optimistic) via PATCH /api/sheets.
export default function SheetVisibilityList({
  sheets,
  hint,
}: {
  sheets: ManageSheet[];
  hint?: string;
}) {
  const [items, setItems] = useState(sheets);
  const [busy, setBusy] = useState<string | null>(null);

  async function toggle(id: string, next: boolean) {
    // Optimistic: update UI dulu, rollback kalau gagal.
    setItems((prev) => prev.map((s) => (s.id === id ? { ...s, isVisible: next } : s)));
    setBusy(id);
    try {
      const res = await fetch('/api/sheets', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, isVisible: next }),
      });
      if (!res.ok) throw new Error('failed');
    } catch {
      setItems((prev) => prev.map((s) => (s.id === id ? { ...s, isVisible: !next } : s)));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {hint && <p className="text-[11px] opacity-50">{hint}</p>}
      <ul className="flex flex-col divide-y divide-foreground/10 rounded-lg border border-foreground/10">
        {items.map((s) => (
          <li key={s.id}>
            <label className="flex cursor-pointer items-center gap-3 p-3 hover:bg-foreground/5">
              <input
                type="checkbox"
                checked={s.isVisible}
                disabled={busy === s.id}
                onChange={(e) => toggle(s.id, e.target.checked)}
                className="h-4 w-4 shrink-0 accent-accent"
              />
              <span className={`truncate text-sm ${s.isVisible ? '' : 'opacity-40 line-through'}`}>
                {s.title}
              </span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}
