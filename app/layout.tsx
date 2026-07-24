import './globals.css';

export const metadata = {
  title: 'Revit Web Viewer',
  description: 'Presentasi 3D & sheet dari Revit, sync real-time.',
};

// Dark mode default sesuai konvensi project (webapp-project-starter #7),
// dengan aksen gold/yellow yang senada dengan flashHighlight di ModelViewer.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" className="dark">
      <body>{children}</body>
    </html>
  );
}
