'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

// Tombol hapus project dengan konfirmasi (dialog konfirmasi native).
export default function DeleteProjectButton({
  id,
  name,
  confirmText,
  label,
}: {
  id: string;
  name: string;
  confirmText: string;
  label: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function del() {
    if (!window.confirm(`${name}\n\n${confirmText}`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/projects?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        alert(j.error || 'Gagal menghapus project.');
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={del}
      disabled={busy}
      className="rounded border border-red-500/40 px-2 py-1 text-xs text-red-400 opacity-80 hover:opacity-100 disabled:opacity-40"
    >
      {busy ? '…' : label}
    </button>
  );
}
