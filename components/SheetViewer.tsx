'use client';

import { useEffect, useRef } from 'react';
import * as pdfjsLib from 'pdfjs-dist';

pdfjsLib.GlobalWorkerOptions.workerSrc =
  '//cdnjs.cloudflare.com/ajax/libs/pdf.js/4.6.0/pdf.worker.min.mjs';

interface SheetViewerProps {
  pdfUrl: string;
  sheetName?: string;
}

// Render satu sheet PDF ke canvas. Dipanggil per sheet dari daftar
// `sheets` (lihat REVIT-WEB-VIEWER-SETUP.md bagian 4).
export default function SheetViewer({ pdfUrl, sheetName }: SheetViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let cancelled = false;

    async function render() {
      const pdf = await pdfjsLib.getDocument(pdfUrl).promise;
      const page = await pdf.getPage(1);
      const viewport = page.getViewport({ scale: 1.5 });

      const canvas = canvasRef.current;
      if (!canvas || cancelled) return;
      const context = canvas.getContext('2d');
      if (!context) return;

      canvas.width = viewport.width;
      canvas.height = viewport.height;

      await page.render({ canvasContext: context, viewport }).promise;
    }

    render();
    return () => {
      cancelled = true;
    };
  }, [pdfUrl]);

  return (
    <div className="flex flex-col gap-2">
      {sheetName && <div className="text-sm font-medium">{sheetName}</div>}
      <canvas ref={canvasRef} className="w-full rounded border" />
    </div>
  );
}
