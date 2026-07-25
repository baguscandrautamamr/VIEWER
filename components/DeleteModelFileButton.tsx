'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function DeleteModelFileButton({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function del() {
    if (!window.confirm('Hapus file model ini dari daftar?')) return;
    setBusy(true);
    try {
      await fetch(`/api/model-files?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={del}
      disabled={busy}
      className="rounded border border-white/20 px-2 py-1 text-xs opacity-70 hover:opacity-100 disabled:opacity-40"
    >
      {busy ? '…' : 'Hapus'}
    </button>
  );
}
