' dsh-lan-gate hidden launcher
' Used by the scheduled task "dsh-lan-gate" so no console window flashes at logon.
' The path is resolved from this file's own location, so the folder can be moved
' freely (it contains spaces, hence the careful quoting).
'
' ASCII-only on purpose: Windows Script Host reads .vbs as ANSI, so non-ASCII
' comments here would be mangled.

Dim fso, dir, cmd
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)

cmd = "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass " & _
      "-File """ & dir & "\lan-gate.ps1"" start"

' 0 = hidden window, False = do not wait for completion
CreateObject("WScript.Shell").Run cmd, 0, False
