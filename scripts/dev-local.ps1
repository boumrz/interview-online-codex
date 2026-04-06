# Локальная разработка: PostgreSQL в Docker + подсказки по запуску backend/frontend.
# Запуск: из корня репозитория:  powershell -ExecutionPolicy Bypass -File .\scripts\dev-local.ps1
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $Root

$docker = Get-Command docker -ErrorAction SilentlyContinue
if (-not $docker) {
  Write-Error "Нужен Docker Desktop для автоматического подъёма PostgreSQL. Установите Docker или поднимите БД вручную (README)."
}

Write-Host ">>> docker compose -f docker-compose.dev.yml up -d"
docker compose -f docker-compose.dev.yml up -d
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Ожидание PostgreSQL..."
for ($i = 0; $i -lt 45; $i++) {
  & docker exec interview-online-postgres pg_isready -U interview -d interview_online 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) { break }
  Start-Sleep -Seconds 1
}

$Maven = Join-Path $Root ".tools\apache-maven-3.9.9\bin\mvn.cmd"
if (-not (Test-Path $Maven)) {
  Write-Warning "Локальный Maven не найден: $Maven — используйте системный mvn."
  $Maven = "mvn"
}

$jdk17 = "C:\Program Files\Java\jdk-17"
if (Test-Path $jdk17) { $env:JAVA_HOME = $jdk17 }

$env:DB_URL = "jdbc:postgresql://localhost:5432/interview_online"
$env:DB_USER = "interview"
$env:DB_PASSWORD = "interview"

Write-Host ""
Write-Host "База готова. В двух отдельных терминалах выполните:"
Write-Host ""
Write-Host "  Терминал 1 — backend:"
Write-Host "    `$env:JAVA_HOME='$env:JAVA_HOME'"
Write-Host "    `$env:DB_URL='$env:DB_URL'"
Write-Host "    `$env:DB_USER='$env:DB_USER'"
Write-Host "    `$env:DB_PASSWORD='$env:DB_PASSWORD'"
Write-Host "    cd `"$Root\backend`""
Write-Host "    & `"$Maven`" spring-boot:run"
Write-Host ""
Write-Host "  Терминал 2 — frontend:"
Write-Host "    cd `"$Root\frontend`""
Write-Host "    npm run dev"
Write-Host ""
Write-Host "Откройте http://localhost:5173 — запросы /api проксируются на http://localhost:8080"
Write-Host "Остановка БД: docker compose -f docker-compose.dev.yml down"
