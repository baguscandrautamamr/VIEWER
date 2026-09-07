'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function DeleteModelFileButton({
  id,
  label = 'Hapus',
  confirmText = 'Hapus file model ini dari daftar?',
}: {
  id: string;
  label?: string;
  confirmText?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function del() {
    if (!window.confirm(confirmText)) return;
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
      className="rounded border border-foreground/20 px-2 py-1 text-xs opacity-70 hover:opacity-100 disabled:opacity-40"
    >
      {busy ? '…' : label}
    </button>
  );
}
