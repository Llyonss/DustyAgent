Add-Type -TypeDefinition @"
using System.Runtime.InteropServices;
public class DpiAware {
    [DllImport("user32.dll")]
    public static extern bool SetProcessDPIAware();
}
"@ -Language CSharp

[DpiAware]::SetProcessDPIAware() | Out-Null

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$s = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$b = New-Object System.Drawing.Bitmap($s.Width, $s.Height)
[System.Drawing.Graphics]::FromImage($b).CopyFromScreen($s.Location, [System.Drawing.Point]::Empty, $s.Size)
$m = New-Object System.IO.MemoryStream
$b.Save($m, [System.Drawing.Imaging.ImageFormat]::Jpeg)
[Convert]::ToBase64String($m.ToArray())
