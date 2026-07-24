'use client';

import { useState } from 'react';
import { locales, type Locale } from '@/lib/i18n';

interface DownloadRvtButtonProps {
  driveFileId: string;
  locale?: Locale;
}

// Fase 3 (lihat REVIT-WEB-VIEWER-SETUP.md bagian 8). Panggil
// app/api/drive/route.ts untuk resolve link download dari Google Drive
// file ID, supaya service account credential tidak pernah sampai ke client.
export default function DownloadRvtButton({ driveFileId, locale = 'id' }: DownloadRvtButtonProps) {
  const [loading, setLoading] = useState(false);
  const t = locales[locale].viewer;

  async function handleDownload() {
    setLoading(true);
    try {
      const res = await fetch(`/api/drive?fileId=${driveFileId}`);
      const data = await res.json();
      if (data.webContentLink) {
        window.open(data.webContentLink, '_blank');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={handleDownload}
      disabled={loading}
      className="rounded border px-4 py-2 text-sm font-medium disabled:opacity-50"
    >
      {loading ? '...' : t.downloadRvt}
    </button>
  );
}
