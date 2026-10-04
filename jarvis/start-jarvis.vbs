' Starts J.A.R.V.I.S. with no window of any kind — no console, no browser.
' The desktop shortcut points here. Run it twice and it will not start twice.
Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)
Set sh = CreateObject("WScript.Shell")
sh.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & here & "\jarvis.ps1""", 0, False
