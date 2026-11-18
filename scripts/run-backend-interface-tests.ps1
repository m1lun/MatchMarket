#!/usr/bin/env pwsh
<#
Run backend interface test suites with coverage, in order:
  1. tests\mock\
  2. tests\no-mock\
  3. tests\mock\ + tests\no-mock\

Assumes a Node.js + TypeScript project using Jest, with this layout:
  backend\
  ├── src\              source code
  └── tests\
      ├── mock\         interface tests with mocks
      ├── no-mock\      interface tests without mocks
      └── ...           other test directories
Usage:
  .\scripts\run-backend-interface-tests.ps1

NOTE ON EXECUTION POLICY:
  Windows blocks script execution by default. If running this script fails
  with a message about execution policies, either:
    - run once: Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
    - or launch with: pwsh -ExecutionPolicy Bypass -File .\scripts\run-backend-interface-tests.ps1
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Root = (Resolve-Path (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) '..')).Path
$BackendDir = Join-Path $Root 'backend'
$MockDir = Join-Path $BackendDir 'tests\mock'
$NoMockDir = Join-Path $BackendDir 'tests\no-mock'

function Info($msg) { Write-Host "==> $msg" -ForegroundColor Blue }
function Warn($msg) { Write-Host "WARN: $msg" -ForegroundColor Yellow }
function Die($msg)  { Write-Host "ERROR: $msg" -ForegroundColor Red; exit 1 }

function RequireDir($path) {
    if (-not (Test-Path $path -PathType Container)) { Die "Missing directory: $path" }
}

function HasTestFiles($dir, $pattern) {
    if (-not (Test-Path $dir)) { return $false }
    $match = Get-ChildItem -Path $dir -Filter $pattern -Recurse -File -ErrorAction SilentlyContinue |
        Select-Object -First 1
    return [bool]$match
}

function Run-InterfaceTests($label, $coverageDir, [string[]]$testPaths) {
    Info "Running $label interface tests with coverage ($($testPaths -join ' '))..."
    npm test -- @testPaths --coverage "--coverageDirectory=$coverageDir"
    if ($LASTEXITCODE -ne 0) { Die "$label interface tests failed." }
    Write-Host ""
}

# ---------------------------------------------------------------------------
# Prerequisites
# ---------------------------------------------------------------------------

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Die "Node.js not found." }
if (-not (Get-Command npm -ErrorAction SilentlyContinue))  { Die "npm not found." }

RequireDir $BackendDir
$packageJson = Join-Path $BackendDir 'package.json'
if (-not (Test-Path $packageJson)) { Die "Missing $packageJson" }
RequireDir (Join-Path $BackendDir 'src')
RequireDir (Join-Path $BackendDir 'tests')

$pkg = Get-Content $packageJson -Raw | ConvertFrom-Json
$hasTestScript = $false
if ($null -ne $pkg.scripts) {
    $hasTestScript = $null -ne $pkg.scripts.test
}
if (-not $hasTestScript) {
    Die "No `"test`" script found in $packageJson (expected Jest)."
}

$hasMockTests = $false
$hasNoMockTests = $false

if ((Test-Path $MockDir) -and (HasTestFiles $MockDir '*.test.ts')) {
    $hasMockTests = $true
}
elseif (Test-Path $MockDir) {
    Warn "Skipping mocked tests: no files in tests\mock\ (add *.test.ts when ready)."
}
else {
    Warn "Skipping mocked tests: tests\mock\ not found yet."
}

if ((Test-Path $NoMockDir) -and (HasTestFiles $NoMockDir '*.test.ts')) {
    $hasNoMockTests = $true
}
elseif (Test-Path $NoMockDir) {
    Die "No test files found in $NoMockDir (expected *.test.ts)."
}
else {
    Die "Missing directory: $NoMockDir"
}

if (-not $hasMockTests -and -not $hasNoMockTests) {
    Die "No interface tests found under backend\tests\."
}

if (-not (Test-Path (Join-Path $BackendDir 'node_modules'))) {
    Info "Installing dependencies..."
    Push-Location $BackendDir
    try {
        npm install
        if ($LASTEXITCODE -ne 0) { Die "npm install failed." }
    }
    finally {
        Pop-Location
    }
}

# ---------------------------------------------------------------------------
# MongoDB for the tests
# ---------------------------------------------------------------------------
# Uses TEST_MONGODB_URI if set; otherwise starts docker-compose.test.yml and stops it on exit.
$TestCompose = Join-Path $Root 'docker-compose.test.yml'
$StartedMongo = $false
if ($env:TEST_MONGODB_URI) {
    Info "Using MongoDB at $($env:TEST_MONGODB_URI)"
}
else {
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        Die "Docker not found. Install it, or start a MongoDB and set TEST_MONGODB_URI."
    }
    Info "Starting a throwaway MongoDB (docker-compose.test.yml)..."
    docker compose -f $TestCompose up -d --wait
    if ($LASTEXITCODE -ne 0) { Die "Could not start the test MongoDB." }
    $StartedMongo = $true
    $env:TEST_MONGODB_URI = 'mongodb://127.0.0.1:27018/?directConnection=true'
}

# ---------------------------------------------------------------------------
# Run interface test phases
# ---------------------------------------------------------------------------

Push-Location $BackendDir
try {
    if ($hasMockTests) {
        Run-InterfaceTests 'mocked' 'coverage/mock' @('tests/mock/')
    }

    if ($hasNoMockTests) {
        Run-InterfaceTests 'no-mock' 'coverage/no-mock' @('tests/no-mock/')
    }

    if ($hasMockTests -and $hasNoMockTests) {
        Run-InterfaceTests 'all interface' 'coverage/interface' @('tests/mock/', 'tests/no-mock/')
    }
}
finally {
    Pop-Location
    if ($StartedMongo) { docker compose -f $TestCompose down | Out-Null }
}

Info "All backend interface test suites finished."
