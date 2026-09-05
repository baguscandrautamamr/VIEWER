'use client';

import type { ReactNode } from 'react';
import type { locales } from '@/lib/i18n';

// Potongan UI kecil yang dipakai bersama di viewer presentasi. Tema panel
// SENGAJA gelap + aksen hijau limau (seperti video referensi), tidak ikut
// tema halaman — supaya tampilan presentasi konsisten di layar client.

export type ShowcaseStrings = { [K in keyof typeof locales.id.showcase]: string };

export function tpl(s: string, vars: Record<string, string | number>): string {
  return s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
}

export function Panel({
  className = '',
  children,
  style,
}: {
  className?: string;
  children: ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div className={`sc-panel ${className}`} style={style}>
      {children}
    </div>
  );
}

export function Eyebrow({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`sc-eyebrow ${className}`}>{children}</div>;
}

export function Toggle({
  on,
  onChange,
  label,
  icon,
  disabled,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className="sc-row"
    >
      <span className="sc-row-icon">{icon}</span>
      <span className="flex-1 text-left">{label}</span>
      <span className={`sc-switch ${on ? 'is-on' : ''}`} aria-hidden>
        <span className="sc-switch-knob" />
      </span>
    </button>
  );
}

export function RowButton({
  onClick,
  label,
  icon,
  trailing,
  active,
  disabled,
  title,
}: {
  onClick: () => void;
  label: string;
  icon?: ReactNode;
  trailing?: ReactNode;
  active?: boolean;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title} className={`sc-row ${active ? 'is-active' : ''}`}>
      <span className="sc-row-icon">{icon}</span>
      <span className="flex-1 truncate text-left">{label}</span>
      {trailing !== undefined && <span className="sc-row-trailing">{trailing}</span>}
    </button>
  );
}

export function CloseButton({ onClick, label = 'close' }: { onClick: () => void; label?: string }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} className="sc-close">
      ×
    </button>
  );
}

// Ikon garis sederhana (SVG inline, 14px) — tidak perlu library ikon.
const I = ({ d, size = 14 }: { d: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={d} />
  </svg>
);
export const Icons = {
  search: <I d="M21 21l-4.3-4.3M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14z" />,
  tag: <I d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8zM7 7h.01" />,
  pulse: <I d="M3 12h4l3-8 4 16 3-8h4" />,
  layers: <I d="M12 2l10 5-10 5L2 7l10-5zM2 12l10 5 10-5M2 17l10 5 10-5" />,
  stairs: <I d="M4 20h4v-4h4v-4h4V8h4M4 20V4" />,
  reset: <I d="M3 12a9 9 0 1 0 3-6.7M3 3v5h5" />,
  home: <I d="M3 11l9-8 9 8v9a2 2 0 0 1-2 2h-4v-6H9v6H5a2 2 0 0 1-2-2v-9z" />,
  x: <I d="M18 6L6 18M6 6l12 12" />,
  walk: <I d="M13 4a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM9 21l2-7 3 2v5M8 12l2-4 4 1 3 3M15 21l-2-5" />,
  orbit: <I d="M12 12m-3 0a3 3 0 1 0 6 0 3 3 0 1 0-6 0M2 12c0-2 4-4 10-4s10 2 10 4-4 4-10 4S2 14 2 12zM12 2c2 0 4 4 4 10s-2 10-4 10-4-4-4-10 2-10 4-10z" />,
  sun: <I d="M12 3v2M12 19v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M3 12h2M19 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z" />,
  palette: <I d="M12 3a9 9 0 0 0 0 18c1 0 2-.8 2-2 0-.5-.2-1-.5-1.3-.3-.4-.5-.8-.5-1.2 0-1 .8-2 2-2h2a4 4 0 0 0 4-4c0-4.4-4-7.5-9-7.5zM7.5 10a1 1 0 1 0 0 .1M12 7a1 1 0 1 0 0 .1M16.5 10a1 1 0 1 0 0 .1" />,
  rotate: <I d="M21 12a9 9 0 1 1-2.6-6.4M21 3v6h-6" />,
  route: <I d="M6 19a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 13V9a3 3 0 0 1 3-3h4M18 11v4a3 3 0 0 1-3 3h-4" />,
  spark: <I d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3zM19 17l.8 2.2L22 20l-2.2.8L19 23l-.8-2.2L16 20l2.2-.8L19 17z" />,
  sheet: <I d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6zM14 3v6h6M8 13h8M8 17h6" />,
  pin: <I d="M12 22s7-7 7-12a7 7 0 1 0-14 0c0 5 7 12 7 12zM12 10m-2 0a2 2 0 1 0 4 0 2 2 0 1 0-4 0" />,
  arrowRight: <I d="M5 12h14M13 6l6 6-6 6" />,
  arrowLeft: <I d="M19 12H5M11 18l-6-6 6-6" />,
  arrowUpRight: <I d="M7 17L17 7M8 7h9v9" />,
  camera: <I d="M4 7h3l2-3h6l2 3h3a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" />,
  compass: <I d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM16 8l-2.5 6.5L7 17l2.5-6.5L16 8z" />,
  help: <I d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7M12 17h.01" />,
  chevronUp: <I d="M18 15l-6-6-6 6" />,
  chevronDown: <I d="M6 9l6 6 6-6" />,
  send: <I d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />,
  eye: <I d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 12m-3 0a3 3 0 1 0 6 0 3 3 0 1 0-6 0" />,
};
