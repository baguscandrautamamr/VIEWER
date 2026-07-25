using System.Windows.Media;

namespace RevitWebViewer
{
    // Icon vektor untuk tombol ribbon (kubus 3D, senada favicon website).
    // Dibuat dari kode (WPF DrawingImage) supaya tidak perlu file gambar.
    public static class RibbonIcon
    {
        public static ImageSource Build()
        {
            var geo = Geometry.Parse(
                "M32 12 L52 23 L52 41 L32 52 L12 41 L12 23 Z M32 12 L32 32 M12 23 L32 32 L52 23");
            var pen = new Pen(new SolidColorBrush(Color.FromRgb(255, 193, 7)), 3)
            {
                LineJoin = PenLineJoin.Round,
                StartLineCap = PenLineCap.Round,
                EndLineCap = PenLineCap.Round
            };
            var drawing = new GeometryDrawing(null, pen, geo);
            var image = new DrawingImage(drawing);
            image.Freeze();
            return image;
        }
    }
}
