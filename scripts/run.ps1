# اجرای برنامه: روشن کردن دیتابیس، باز کردن مرورگر و اجرای سرور.
. (Join-Path $PSScriptRoot 'db-common.ps1')
Set-Location $ProjectRoot
if (-not (Test-Path (Join-Path $ProjectRoot '.env'))) {
  Write-Host 'هنوز نصب نشده؛ اول install.bat را اجرا کنید.' -ForegroundColor Yellow
  exit 1
}
Start-Db
$port = ((Get-Content .env | Where-Object { $_ -match '^PORT=' }) -replace '^PORT=', '')
if (-not $port) { $port = 3000 }
Start-Process "http://localhost:$port"
Write-Host "برنامه روی http://localhost:$port اجرا شد. برای خاموش کردن این پنجره را ببندید."
node server.js
