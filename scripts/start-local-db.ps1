# روشن کردن دیتابیس لپ‌تاپ (MariaDB 10.11 — همان نسخه‌ی سرور آروان) روی پورت 3307.
# اجرا: powershell -File scripts\start-local-db.ps1
# پوشه‌ی برنامه و داده: C:\crm-template-mariadb (رمزها در C:\crm-template-mariadb\LOCAL-SECRETS.txt، بیرون از گیت)
$root = 'C:\crm-template-mariadb'
if ((Test-NetConnection -ComputerName 127.0.0.1 -Port 3307 -WarningAction SilentlyContinue).TcpTestSucceeded) {
  Write-Output 'دیتابیس از قبل روشن است.'
  exit 0
}
Start-Process -FilePath "$root\bin\mariadbd.exe" -ArgumentList "--defaults-file=$root\data\my.ini" -WindowStyle Hidden
Start-Sleep -Seconds 4
if ((Test-NetConnection -ComputerName 127.0.0.1 -Port 3307 -WarningAction SilentlyContinue).TcpTestSucceeded) {
  Write-Output 'دیتابیس روشن شد (پورت 3307).'
} else {
  Write-Output 'روشن نشد؛ فایل خطا را ببینید: C:\crm-template-mariadb\data\*.err'
  exit 1
}
