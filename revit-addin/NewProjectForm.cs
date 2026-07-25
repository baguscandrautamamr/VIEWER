using System;
using System.Drawing;
using System.Windows.Forms;

namespace RevitWebViewer
{
    // Dialog buat project baru langsung dari Revit (insert ke tabel projects).
    public class NewProjectForm : Form
    {
        private readonly TextBox _name = new TextBox { Dock = DockStyle.Fill };
        private readonly TextBox _token = new TextBox { Dock = DockStyle.Fill };

        public string ProjectName { get; private set; }
        public string Token { get; private set; }

        public NewProjectForm()
        {
            Text = "Buat Project Baru";
            FormBorderStyle = FormBorderStyle.FixedDialog;
            StartPosition = FormStartPosition.CenterParent;
            MaximizeBox = false;
            MinimizeBox = false;
            ShowInTaskbar = false;
            ClientSize = new Size(470, 210);
            Font = new Font("Segoe UI", 9f);

            _token.Text = Guid.NewGuid().ToString("N"); // token acak default

            var layout = new TableLayoutPanel
            {
                Dock = DockStyle.Fill,
                ColumnCount = 2,
                Padding = new Padding(14, 12, 14, 8)
            };
            layout.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 110));
            layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));

            AddRow(layout, "Nama Project", _name);

            var tokenRow = new TableLayoutPanel
            {
                ColumnCount = 2,
                Dock = DockStyle.Fill,
                AutoSize = true,
                Margin = new Padding(0, 3, 0, 3)
            };
            tokenRow.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            tokenRow.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 88));
            var gen = new Button { Text = "Acak", Width = 82, Anchor = AnchorStyles.Right };
            gen.Click += (s, e) => _token.Text = Guid.NewGuid().ToString("N");
            tokenRow.Controls.Add(_token, 0, 0);
            tokenRow.Controls.Add(gen, 1, 0);
            AddRow(layout, "Access Token", tokenRow);

            AddRow(layout, "", new Label
            {
                Text = "Token dipakai di link presentasi client (?t=...). Rahasiakan.",
                AutoSize = true,
                ForeColor = SystemColors.GrayText,
                Margin = new Padding(0, 2, 0, 0)
            });

            var ok = new Button { Text = "Buat", Width = 90, Height = 28 };
            var cancel = new Button { Text = "Batal", Width = 90, Height = 28, DialogResult = DialogResult.Cancel };
            ok.Click += (s, e) => Accept();

            var bar = new FlowLayoutPanel
            {
                Dock = DockStyle.Bottom,
                FlowDirection = FlowDirection.RightToLeft,
                Padding = new Padding(14, 8, 14, 12),
                Height = 52
            };
            bar.Controls.Add(ok);
            bar.Controls.Add(cancel);

            Controls.Add(layout);
            Controls.Add(bar);
            AcceptButton = ok;
            CancelButton = cancel;
        }

        private void Accept()
        {
            if (string.IsNullOrWhiteSpace(_name.Text))
            {
                MessageBox.Show(this, "Nama project belum diisi.", "Belum lengkap",
                    MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }
            if (string.IsNullOrWhiteSpace(_token.Text))
            {
                MessageBox.Show(this, "Access token belum diisi.", "Belum lengkap",
                    MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }
            ProjectName = _name.Text.Trim();
            Token = _token.Text.Trim();
            DialogResult = DialogResult.OK;
            Close();
        }

        private static void AddRow(TableLayoutPanel layout, string label, Control field)
        {
            int row = layout.RowCount;
            layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            var lbl = new Label
            {
                Text = label,
                AutoSize = false,
                Dock = DockStyle.Fill,
                TextAlign = ContentAlignment.MiddleLeft,
                Margin = new Padding(0, 6, 8, 0)
            };
            layout.Controls.Add(lbl, 0, row);
            layout.Controls.Add(field, 1, row);
            layout.RowCount = row + 1;
        }
    }
}
