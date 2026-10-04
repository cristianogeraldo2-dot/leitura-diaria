# Brings the invisible J.A.R.V.I.S. window back onto the screen.
#
# For when you want the interface itself: the reactor, the blades he puts things
# on, D for diagnostics, T for the audio self-test. Stop and start him again to
# put it back out of sight.

Add-Type -Namespace Win -Name Api -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
'@

$win = Get-Process chrome -ErrorAction SilentlyContinue |
       Where-Object { $_.MainWindowTitle -like '*J.A.R.V.I.S*' } |
       Select-Object -First 1
if (-not $win) { exit 1 }

[Win.Api]::ShowWindow($win.MainWindowHandle, 9) | Out-Null   # SW_RESTORE
[Win.Api]::MoveWindow($win.MainWindowHandle, 80, 60, 1280, 800, $true) | Out-Null
[Win.Api]::SetForegroundWindow($win.MainWindowHandle) | Out-Null
