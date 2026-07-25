using System;
using System.Drawing;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace RevitWebViewer
{
    // Dialog progress modal. Menjalankan pekerjaan (IfcConvert + upload + DB)
    // di thread background sambil menampilkan marquee, supaya Revit tidak
    // "Not Responding" saat upload file besar. Pekerjaan TIDAK menyentuh Revit
    // API (aman di luar UI thread).
    public class ProgressDialog : Form
    {
        private readonly Func<Task<string>> _work;

        public string Result { get; private set; }
        public Exception Error { get; private set; }

        public ProgressDialog(string message, Func<Task<string>> work)
        {
            _work = work;

            Text = "Revit Web Viewer";
            FormBorderStyle = FormBorderStyle.FixedDialog;
            StartPosition = FormStartPosition.CenterScreen;
            ControlBox = false;
            MaximizeBox = false;
            MinimizeBox = false;
            ShowInTaskbar = false;
            ClientSize = new Size(430, 110);
            Font = new Font("Segoe UI", 9f);

            var lbl = new Label
            {
                Text = message,
                Dock = DockStyle.Top,
                Height = 52,
                Padding = new Padding(16, 16, 16, 0)
            };

            var bar = new ProgressBar
            {
                Style = ProgressBarStyle.Marquee,
                MarqueeAnimationSpeed = 30,
                Dock = DockStyle.Fill
            };
            var barHost = new Panel { Dock = DockStyle.Top, Height = 46, Padding = new Padding(16, 6, 16, 12) };
            barHost.Controls.Add(bar);

            Controls.Add(barHost); // ditambah dulu -> berada di bawah label
            Controls.Add(lbl);     // ditambah terakhir -> menempel paling atas

            Shown += OnShown;
        }

        private async void OnShown(object sender, EventArgs e)
        {
            try { Result = await Task.Run(_work); }
            catch (Exception ex) { Error = ex; }
            finally
            {
                DialogResult = DialogResult.OK;
                Close();
            }
        }
    }
}
