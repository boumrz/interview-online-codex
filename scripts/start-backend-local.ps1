# Backend с встроенной БД H2 (без Docker / PostgreSQL). Порт API: 8080 под прокси фронта.
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$Maven = Join-Path $Root ".tools\apache-maven-3.9.9\bin\mvn.cmd"
if (-not (Test-Path $Maven)) { $Maven = "mvn" }

$jdk = "C:\Program Files\Java\jdk-17"
if (Test-Path $jdk) { $env:JAVA_HOME = $jdk }

# Иначе Spring может уехать на 8090 и /api с 5173 перестанет попадать в API
Remove-Item Env:\SERVER_PORT -ErrorAction SilentlyContinue
Remove-Item Env:\PORT -ErrorAction SilentlyContinue

$env:SPRING_PROFILES_ACTIVE = "local"
Set-Location (Join-Path $Root "backend")
Write-Host "Запуск backend (profile=local, H2 in-memory) на http://localhost:8080 ..."
& $Maven spring-boot:run "-Dspring-boot.run.profiles=local"
