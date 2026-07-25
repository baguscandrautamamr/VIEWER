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

            var settingsBtn = new PushButtonData(
                "RwvSettings",
                "Penga-\nturan",
                asmPath,
                "RevitWebViewer.SettingsCommand");
            settingsBtn.ToolTip = "Isi/ubah koneksi Supabase, Project ID, dan path IfcConvert.";
            settingsBtn.LongDescription =
                "Buka form untuk mengisi konfigurasi add-in (Supabase URL, Service Role " +
                "Key, Project ID, Bucket, path IfcConvert.exe, Present Base URL). " +
                "Tersimpan otomatis, tidak perlu edit file JSON manual.";

            panel.AddItem(settingsBtn);
            return Result.Succeeded;
        }

        public Result OnShutdown(UIControlledApplication app)
        {
            return Result.Succeeded;
        }
    }
}
