# Stops the PocketFinance server (the restart loop and node) started from this folder.
$here = [regex]::Escape($PSScriptRoot)
Get-CimInstance Win32_Process |
  Where-Object { $_.CommandLine -match "$here\\(run\.cmd|server\\index\.js)" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
"PocketFinance server stopped."
