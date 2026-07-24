'use client';

interface VersionBadgeProps {
  versionNumber: number;
  pushedAt: string;
}

// Indikator kecil "versi terbaru" di halaman presentasi, diupdate dari
// parent tiap kali ada event realtime baru (lihat lib/realtime.ts).
export default function VersionBadge({ versionNumber, pushedAt }: VersionBadgeProps) {
  const formatted = new Date(pushedAt).toLocaleString('id-ID', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  return (
    <div className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs">
      <span className="h-2 w-2 rounded-full bg-green-500" />
      <span>v{versionNumber}</span>
      <span className="opacity-60">{formatted}</span>
    </div>
  );
}
