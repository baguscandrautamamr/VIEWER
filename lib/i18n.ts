export const locales = {
  id: {
    viewer: {
      resetView: 'Reset Tampilan',
      isolateHint: 'Klik object untuk isolate',
      liveUpdate: 'Versi terbaru diterima, memperbarui tampilan...',
      downloadRvt: 'Unduh File Revit',
    },
    sheets: {
      title: 'Daftar Sheet',
    },
    access: {
      enterPin: 'Masukkan PIN akses',
      invalidPin: 'PIN salah, coba lagi',
    },
  },
  en: {
    viewer: {
      resetView: 'Reset View',
      isolateHint: 'Click an object to isolate',
      liveUpdate: 'New version received, updating view...',
      downloadRvt: 'Download Revit File',
    },
    sheets: {
      title: 'Sheet List',
    },
    access: {
      enterPin: 'Enter access PIN',
      invalidPin: 'Incorrect PIN, try again',
    },
  },
} as const;

export type Locale = keyof typeof locales;
