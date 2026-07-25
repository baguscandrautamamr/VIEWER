import { cookies } from 'next/headers';
import { locales, type Locale } from './i18n';

export const LANG_COOKIE = 'rwv_lang';
export const THEME_COOKIE = 'rwv_theme';

export type Theme = 'dark' | 'light';

// Dibaca server-side (SSR konsisten, tanpa flash / hydration mismatch).
export async function getLocale(): Promise<Locale> {
  const v = (await cookies()).get(LANG_COOKIE)?.value;
  return v === 'en' ? 'en' : 'id';
}

export async function getTheme(): Promise<Theme> {
  const v = (await cookies()).get(THEME_COOKIE)?.value;
  return v === 'light' ? 'light' : 'dark';
}

// Ambil kamus string sesuai locale aktif.
export async function getStrings() {
  return locales[await getLocale()];
}
