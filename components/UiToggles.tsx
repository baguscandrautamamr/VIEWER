'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

// Toggle bahasa (ID/EN) & tema (terang/gelap). Preferensi disimpan di cookie
// supaya halaman server ikut baca. Bahasa perlu refresh (server re-render);
// tema langsung diterapkan ke <html> (tanpa reload).
export default function UiToggles({
  locale,
  theme,
}: {
  locale: 'id' | 'en';
  theme: 'dark' | 'light';
}) {
  const router = useRouter();
  const [curTheme, setCurTheme] = useState(theme);

  function setCookie(name: string, value: string) {
    document.cookie = `${name}=${value}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
  }

  function toggleLang() {
    setCookie('rwv_lang', locale === 'id' ? 'en' : 'id');
    router.refresh();
  }

  function toggleTheme() {
    const next = curTheme === 'dark' ? 'light' : 'dark';
    setCookie('rwv_theme', next);
    const root = document.documentElement;
    root.classList.remove('dark', 'light');
    root.classList.add(next);
    setCurTheme(next);
  }

  const btn =
    'rounded border border-foreground/20 px-2 py-1 text-xs opacity-80 hover:opacity-100';

  return (
    <div className="flex items-center gap-2">
      <button onClick={toggleLang} className={btn} title="Language">
        {locale === 'id' ? 'EN' : 'ID'}
      </button>
      <button onClick={toggleTheme} className={btn} title="Theme">
        {curTheme === 'dark' ? '☀︎' : '☾'}
      </button>
    </div>
  );
}
