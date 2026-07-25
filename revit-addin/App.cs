using System;
using System.Reflection;
using Autodesk.Revit.UI;

namespace RevitWebViewer
{
    // Bikin tab + tombol di ribbon Revit. Sama untuk Revit 2023 & 2025
    // (API ribbon identik di kedua versi).
    public class App : IExternalApplication
    {
        public Result OnStartup(UIControlledApplication app)
        {
            const string tab = "Revit Web Viewer";
            try { app.CreateRibbonTab(tab); } catch { /* tab sudah ada */ }

            RibbonPanel panel = app.CreateRibbonPanel(tab, "Sync");
            string asmPath = Assembly.GetExecutingAssembly().Location;

            var btn = new PushButtonData(
                "RwvExportPush",
                "Export &\nPush",
                asmPath,
                "RevitWebViewer.ExportPushCommand");
            btn.ToolTip = "Export 3D view aktif jadi GLB dan push ke website viewer.";
            btn.LongDescription =
                "Isolate dulu ke disiplin electrical di 3D view, lalu klik tombol ini. " +
                "Add-in export IFC dari view aktif, convert ke GLB (IfcConvert), upload " +
                "ke Supabase, deteksi kategori, dan tambah versi baru.";

            panel.AddItem(btn);
            return Result.Succeeded;
        }

        public Result OnShutdown(UIControlledApplication app)
        {
            return Result.Succeeded;
        }
    }
}
