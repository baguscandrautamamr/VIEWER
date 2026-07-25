namespace RevitWebViewer
{
    // Penanda build. Ditampilkan di judul dialog supaya kita bisa memastikan
    // DLL versi mana yang benar-benar di-load Revit (kalau error lama muncul
    // lagi tapi tag ini berubah, berarti DLL sudah ter-update).
    public static class AppInfo
    {
        public const string BuildTag = "2026-07-25h-drive";
    }
}
