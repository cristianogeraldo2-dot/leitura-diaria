' Stops J.A.R.V.I.S. The desktop "Stop JARVIS" shortcut points here.
Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)
Set sh = CreateObject("WScript.Shell")
sh.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & here & "\stop-jarvis.ps1""", 0, False
