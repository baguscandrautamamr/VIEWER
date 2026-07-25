'use client';

import { useState } from 'react';

// Copy link presentasi lengkap (origin + path) ke clipboard.
export default function CopyLinkButton({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    const url = window.location.origin + path;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt('Copy link ini:', url);
    }
  }

  return (
    <button
      onClick={copy}
      className="rounded border border-white/20 px-2 py-1 text-xs opacity-80 hover:opacity-100"
    >
      {copied ? 'Tersalin ✓' : 'Copy link'}
    </button>
  );
}
