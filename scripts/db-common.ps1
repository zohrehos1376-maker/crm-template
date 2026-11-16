# توابع مشترک دیتابیس محلی (MariaDB قابل‌حمل داخل پوشه‌ی پروژه: .mariadb\ — بیرون از گیت).
$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$DbRoot = Join-Path $ProjectRoot '.mariadb'
$DbData = Join-Path $DbRoot 'data'
$DbPort = 3310

function Test-DbUp {
  try {
    $c = New-Object System.Net.Sockets.TcpClient
    $c.Connect('127.0.0.1', $DbPort); $c.Close(); return $true
  } catch { return $false }
}

function Start-Db {
  if (Test-DbUp) { return }
  Start-Process -FilePath (Join-Path $DbRoot 'bin\mariadbd.exe') -ArgumentList "--defaults-file=`"$DbData\my.ini`"" -WindowStyle Hidden
  for ($i = 0; $i -lt 30; $i++) { Start-Sleep -Seconds 1; if (Test-DbUp) { return } }
  throw "دیتابیس روشن نشد. فایل خطا: $DbData\*.err"
}
