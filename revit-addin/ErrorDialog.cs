using System.Drawing;
using System.Windows.Forms;

namespace RevitWebViewer
{
    // Dialog error dengan detail teknis lengkap (type + message + stack trace),
    // scrollable & bisa di-copy. Dipakai buat mendiagnosa kegagalan export.
    public class ErrorDialog : Form
    {
        public ErrorDialog(string title, string detail)
        {
            Text = title;
            StartPosition = FormStartPosition.CenterScreen;
            ClientSize = new Size(700, 470);
            Font = new Font("Segoe UI", 9f);
            MinimizeBox = false;
            MaximizeBox = true;
            ShowInTaskbar = false;

            var box = new TextBox
            {
                Multiline = true,
                ReadOnly = true,
                Dock = DockStyle.Fill,
                ScrollBars = ScrollBars.Both,
                WordWrap = false,
                Text = detail,
                Font = new Font("Consolas", 9f)
            };

            var copy = new Button { Text = "Copy semua", Width = 100, Height = 28 };
            var close = new Button { Text = "Tutup", Width = 90, Height = 28, DialogResult = DialogResult.OK };
            copy.Click += (s, e) => { try { Clipboard.SetText(detail); } catch { /* clipboard sibuk */ } };

            var bar = new FlowLayoutPanel
            {
                Dock = DockStyle.Bottom,
                FlowDirection = FlowDirection.RightToLeft,
                Padding = new Padding(10, 8, 10, 10),
                Height = 50
            };
            bar.Controls.Add(close);
            bar.Controls.Add(copy);

            var panel = new Panel { Dock = DockStyle.Fill, Padding = new Padding(10, 10, 10, 0) };
            panel.Controls.Add(box);

            Controls.Add(panel);
            Controls.Add(bar);
            AcceptButton = close;
        }

        public static void Display(string title, string detail)
        {
            using (var f = new ErrorDialog(title, detail))
                f.ShowDialog();
        }
    }
}
