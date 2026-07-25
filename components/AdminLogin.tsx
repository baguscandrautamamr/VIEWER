'use client';

import { useState } from 'react';

// Form login admin (muncul hanya kalau VIEWER_ADMIN_PASSWORD di-set).
export default function AdminLogin() {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    setLoading(true);
    try {
      const res = await fetch('/api/admin-login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password: pw }),
      });
      if (res.ok) {
        window.location.reload();
      } else {
        setErr('Password salah.');
      }
    } catch {
      setErr('Gagal login. Coba lagi.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex h-screen items-center justify-center p-6">
      <form onSubmit={submit} className="w-full max-w-xs rounded-lg border border-white/10 p-6">
        <h1 className="mb-1 text-base font-medium">Revit Web Viewer</h1>
        <p className="mb-4 text-xs opacity-60">Masukkan password untuk melihat daftar project.</p>
        <input
          type="password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          placeholder="Password"
          autoFocus
          className="w-full rounded border border-white/20 bg-transparent px-3 py-2 text-sm outline-none focus:border-white/50"
        />
        {err && <p className="mt-2 text-xs text-red-400">{err}</p>}
        <button
          type="submit"
          disabled={loading}
          className="mt-4 w-full rounded bg-white px-3 py-2 text-sm font-medium text-black disabled:opacity-50"
        >
          {loading ? 'Masuk…' : 'Masuk'}
        </button>
      </form>
    </main>
  );
}
