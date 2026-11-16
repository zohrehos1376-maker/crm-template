# نصب یک‌مرحله‌ای روی ویندوز: دیتابیس، تنظیمات، بسته‌ها، جدول‌ها، مدیر و داده‌ی نمونه.
# اجرا: دو بار کلیک روی install.bat (اجرای دوباره بی‌خطر است؛ چیزی پاک نمی‌شود).
. (Join-Path $PSScriptRoot 'db-common.ps1')
Set-Location $ProjectRoot
function Say($m) { Write-Host "`n>> $m" -ForegroundColor Cyan }
function New-Secret($n) { -join ((48..57) + (97..122) | Get-Random -Count $n | ForEach-Object { [char]$_ }) }

# ۱) Node.js
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Say 'Node.js نصب نیست؛ در حال نصب با winget...'
  winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
  Write-Host "`nNode.js نصب شد. این پنجره را ببندید و install.bat را دوباره اجرا کنید." -ForegroundColor Yellow
  exit 0
}

# ۲) MariaDB قابل‌حمل (بدون نصب روی ویندوز)
$secretsFile = Join-Path $DbRoot 'SECRETS.txt'
if (-not (Test-Path (Join-Path $DbRoot 'bin\mariadbd.exe'))) {
  $ver = '10.11.10'
  $zip = Join-Path $env:TEMP "mariadb-$ver-winx64.zip"
  if (-not (Test-Path $zip)) {
    Say "دانلود MariaDB $ver (حدود ۹۰ مگابایت)..."
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $ProgressPreference = 'SilentlyContinue'
    Invoke-WebRequest "https://archive.mariadb.org/mariadb-$ver/winx64-packages/mariadb-$ver-winx64.zip" -OutFile $zip
  }
  Say 'باز کردن MariaDB...'
  $tmp = Join-Path $env:TEMP "mariadb-extract-$ver"
  if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
  Expand-Archive $zip -DestinationPath $tmp
  Move-Item (Get-ChildItem $tmp -Directory | Select-Object -First 1).FullName $DbRoot
  Remove-Item $tmp -Recurse -Force
}
if (-not (Test-Path (Join-Path $DbData 'my.ini'))) {
  Say 'ساخت دیتابیس خالی...'
  $rootPw = New-Secret 24
  & (Join-Path $DbRoot 'bin\mariadb-install-db.exe') "--datadir=$DbData" "--port=$DbPort" "--password=$rootPw" | Out-Null
  "root=$rootPw" | Set-Content $secretsFile -Encoding ascii
}
Start-Db

# ۳) دیتابیس و کاربر برنامه + فایل .env
$envFile = Join-Path $ProjectRoot '.env'
if (-not (Test-Path $envFile)) {
  Say 'ساخت فایل تنظیمات (.env)...'
  $rootPw = ((Get-Content $secretsFile | Where-Object { $_ -like 'root=*' }) -replace '^root=', '')
  $appPw = New-Secret 24
  $sql = "CREATE DATABASE IF NOT EXISTS crm_template CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;" +
         "CREATE USER IF NOT EXISTS 'crm_template'@'localhost' IDENTIFIED BY '$appPw';" +
         "CREATE USER IF NOT EXISTS 'crm_template'@'127.0.0.1' IDENTIFIED BY '$appPw';" +
         "ALTER USER 'crm_template'@'localhost' IDENTIFIED BY '$appPw';" +
         "ALTER USER 'crm_template'@'127.0.0.1' IDENTIFIED BY '$appPw';" +
         "GRANT ALL ON crm_template.* TO 'crm_template'@'localhost';" +
         "GRANT ALL ON crm_template.* TO 'crm_template'@'127.0.0.1'; FLUSH PRIVILEGES;"
  $env:MYSQL_PWD = $rootPw
  & (Join-Path $DbRoot 'bin\mariadb.exe') -h 127.0.0.1 -P $DbPort -u root -e $sql
  if ($LASTEXITCODE -ne 0) { throw 'ساخت دیتابیس ناموفق بود.' }
  Remove-Item Env:MYSQL_PWD
  $text = Get-Content (Join-Path $ProjectRoot '.env.example') -Raw -Encoding UTF8
  $text = $text -replace '(?m)^SESSION_SECRET=.*', ('SESSION_SECRET=' + (New-Secret 32) + (New-Secret 32))
  $text = $text -replace '(?m)^DATABASE_URL=.*', "DATABASE_URL=mysql://crm_template:$appPw@127.0.0.1:$DbPort/crm_template"
  [IO.File]::WriteAllText($envFile, $text, (New-Object Text.UTF8Encoding $false))
}

# ۴) بسته‌ها و جدول‌ها
Say 'نصب بسته‌ها (npm install)... چند دقیقه طول می‌کشد.'
npm install --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw 'npm install ناموفق بود.' }
npm run db:generate
if ($LASTEXITCODE -ne 0) { throw 'ساخت لایه‌ی دیتابیس (prisma generate) ناموفق بود.' }
Say 'ساخت جدول‌ها...'
npx prisma migrate deploy
if ($LASTEXITCODE -ne 0) { throw 'ساخت جدول‌ها ناموفق بود.' }

# ۵) مدیر و داده‌ی نمونه (فقط بار اول)
Say 'ساخت حساب مدیر و داده‌ی نمونه...'
node -e "require('dotenv').config({quiet:true});require('./modules/core/services/userService').seedIfEmpty().then(()=>process.exit(0))" | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'ساخت حساب مدیر ناموفق بود.' }
node scripts/seed-demo.js
if ($LASTEXITCODE -ne 0) { throw 'داده‌ی نمونه ساخته نشد.' }
node scripts/seed-demo-calls.js
if ($LASTEXITCODE -ne 0) { throw 'تماس‌های نمونه ساخته نشد.' }

Write-Host "`n=========================================" -ForegroundColor Green
Write-Host ' نصب تمام شد. برای اجرا: run.bat' -ForegroundColor Green
Write-Host ' نام کاربری: admin   رمز: در فایل modules\core\SETUP.txt' -ForegroundColor Green
Write-Host "=========================================" -ForegroundColor Green
