# Makes PocketFinance start (hidden) every time you sign in to Windows, and starts it now.
$startup = [Environment]::GetFolderPath('Startup')
$ws = New-Object -ComObject WScript.Shell
$lnk = $ws.CreateShortcut("$startup\PocketFinance Server.lnk")
$lnk.TargetPath = "$env:WINDIR\System32\wscript.exe"
$lnk.Arguments = "`"$PSScriptRoot\start-hidden.vbs`""
$lnk.WorkingDirectory = $PSScriptRoot
$lnk.Description = 'PocketFinance personal finance server'
$lnk.Save()
# Desktop shortcut that opens the app
$desk = [Environment]::GetFolderPath('Desktop')
$url = $ws.CreateShortcut("$desk\PocketFinance.url")
$url.TargetPath = 'http://127.0.0.1:48140/'
$url.Save()
& "$PSScriptRoot\stop.ps1" | Out-Null
Start-Process wscript.exe -ArgumentList "`"$PSScriptRoot\start-hidden.vbs`""
"PocketFinance will now start automatically when you sign in. Open http://127.0.0.1:48140  (Remove: delete $startup\PocketFinance Server.lnk)"
