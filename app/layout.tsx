import './globals.css';
import { getTheme, getLocale } from '@/lib/uiPrefs';

export const metadata = {
  title: 'Revit Web Viewer',
  description: 'Presentasi 3D & sheet dari Revit, sync real-time.',
};

// Theme & bahasa dibaca dari cookie server-side (SSR konsisten).
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [theme, locale] = await Promise.all([getTheme(), getLocale()]);
  return (
    <html lang={locale} className={theme}>
      <body>{children}</body>
    </html>
  );
}
