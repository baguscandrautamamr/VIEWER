'use client';

import { useState } from 'react';

interface LoginStrings {
  title: string;
  prompt: string;
  password: string;
  submit: string;
  submitting: string;
  wrong: string;
}

const fallback: LoginStrings = {
  title: 'Revit Web Viewer',
  prompt: 'Masukkan password untuk melihat daftar project.',
  password: 'Password',
  submit: 'Masuk',
  submitting: 'Masuk…',
  wrong: 'Password salah.',
};

// Form login admin (muncul hanya kalau VIEWER_ADMIN_PASSWORD di-set).
export default function AdminLogin({ t = fallback }: { t?: LoginStrings }) {
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
        setErr(t.wrong);
      }
    } catch {
      setErr(t.wrong);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex h-screen items-center justify-center p-6">
      <form onSubmit={submit} className="w-full max-w-xs rounded-lg border border-foreground/10 p-6">
        <h1 className="mb-1 text-base font-medium">{t.title}</h1>
        <p className="mb-4 text-xs opacity-60">{t.prompt}</p>
        <input
          type="password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          placeholder={t.password}
          autoFocus
          className="w-full rounded border border-foreground/20 bg-transparent px-3 py-2 text-sm outline-none focus:border-foreground/50"
        />
        {err && <p className="mt-2 text-xs text-red-400">{err}</p>}
        <button
          type="submit"
          disabled={loading}
          className="mt-4 w-full rounded bg-foreground px-3 py-2 text-sm font-medium text-background disabled:opacity-50"
        >
          {loading ? t.submitting : t.submit}
        </button>
      </form>
    </main>
  );
}
