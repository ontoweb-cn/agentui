# E2E 辅助:清扫残留 BFF 进程(tsx watch 子进程)并确认端口释放
$procs = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*bff*src*index.ts*' }
foreach ($p in $procs) {
  Write-Output ("killing " + $p.ProcessId + " : " + $p.CommandLine.Substring(0, [Math]::Min(120, $p.CommandLine.Length)))
  taskkill /PID $p.ProcessId /T /F 2>$null | Out-Null
}
Start-Sleep -Seconds 2
$listener = Get-NetTCPConnection -LocalPort 9390 -State Listen -ErrorAction SilentlyContinue
if ($listener) {
  Write-Output "PORT 9390 STILL LISTENING (pid(s): $($listener.OwningProcess -join ','))"
} else {
  Write-Output "PORT 9390 FREE"
}
