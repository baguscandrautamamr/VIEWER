using System;
using Autodesk.Revit.Attributes;
using Autodesk.Revit.UI;

namespace RevitWebViewer
{
    // Tombol "Pengaturan". Buka form isian config (Supabase, Project ID,
    // IfcConvert, dll) lalu simpan ke %AppData%\RevitWebViewer\. Tidak butuh
    // dokumen terbuka, jadi bisa diklik kapan saja.
    [Transaction(TransactionMode.ReadOnly)]
    public class SettingsCommand : IExternalCommand
    {
        public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements)
        {
            try
            {
                bool saved = SettingsForm.Edit(Config.ReadRaw());
                if (saved)
                    TaskDialog.Show("Revit Web Viewer",
                        "Pengaturan tersimpan di:\n" + Config.UserConfigPath);
                return Result.Succeeded;
            }
            catch (Exception ex)
            {
                TaskDialog.Show("Revit Web Viewer — Pengaturan", ex.Message);
                message = ex.Message;
                return Result.Failed;
            }
        }
    }
}
