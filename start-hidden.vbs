' Starts TaskForce in the background with no window. Output goes to data\server.log
Set fso = CreateObject("Scripting.FileSystemObject")
folder = fso.GetParentFolderName(WScript.ScriptFullName)
If Not fso.FolderExists(folder & "\data") Then fso.CreateFolder(folder & "\data")
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = folder
sh.Run "cmd /c node --no-warnings server.js >> ""data\server.log"" 2>&1", 0, False
