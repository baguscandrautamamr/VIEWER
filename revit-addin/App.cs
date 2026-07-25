using System;
using System.Reflection;
using System.Windows.Media;
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

            // Icon dibuat sekali; kalau gagal (mis. konteks tanpa WPF) tombol
            // tetap muncul tanpa gambar.
            ImageSource icon = null;
            try { icon = RibbonIcon.Build(); } catch { /* tanpa icon */ }

            var btn = new PushButtonData(
                "RwvExportPush",
                "Export &\nPush",
                asmPath,
                "RevitWebViewer.ExportPushCommand");
            btn.ToolTip = "Export 3D view aktif jadi GLB dan push ke website viewer.";
            btn.LongDescription =
                "Isolate dulu ke disiplin electrical di 3D view, lalu klik tombol ini. " +
                "Add-in export IFC dari view aktif, convert ke GLB (IfcConvert), upload " +
                "ke Google Drive, dan tambah versi baru.";
            if (icon != null) btn.LargeImage = icon;
            panel.AddItem(btn);

            var sheetsBtn = new PushButtonData(
                "RwvSyncSheets",
                "Sync\nSheets",
                asmPath,
                "RevitWebViewer.SyncSheetsCommand");
            sheetsBtn.ToolTip = "Export semua sheet jadi PDF dan sync ke website (ringan).";
            sheetsBtn.LongDescription =
                "Meng-export tiap sheet jadi PDF, upload ke Google Drive, dan mencatatnya " +
                "di website. Klik sheet di viewer akan memindahkan sudut kamera 3D sesuai " +
                "orientasi sheet.";
            if (icon != null) sheetsBtn.LargeImage = icon;
            panel.AddItem(sheetsBtn);

            var settingsBtn = new PushButtonData(
                "RwvSettings",
                "Penga-\nturan",
                asmPath,
                "RevitWebViewer.SettingsCommand");
            settingsBtn.ToolTip = "Isi/ubah koneksi Supabase, Project ID, path IfcConvert, dan Present URL.";
            settingsBtn.LongDescription =
                "Buka form untuk mengisi konfigurasi add-in (Supabase URL, Service Role " +
                "Key, Project ID, Bucket, path IfcConvert.exe, Present Base URL). " +
                "Tersimpan otomatis, tidak perlu edit file JSON manual.";
            if (icon != null) settingsBtn.LargeImage = icon;
            panel.AddItem(settingsBtn);

            return Result.Succeeded;
        }

        public Result OnShutdown(UIControlledApplication app)
        {
            return Result.Succeeded;
        }
    }
}
