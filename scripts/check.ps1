param([switch]$Browser)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$python = Join-Path $projectRoot '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $python)) { throw 'Create .venv and install backend[test,evaluation] first.' }

function Invoke-Check($Program, $CommandArgs) {
    & $Program @CommandArgs
    if ($LASTEXITCODE -ne 0) { throw "Check failed: $Program $($CommandArgs -join ' ')" }
}

Push-Location $projectRoot
try {
    Invoke-Check $python @('-m', 'pip', 'check')
    Invoke-Check $python @('-m', 'pytest', 'backend/tests', 'evaluation/test_runner.py', '-q')
    Invoke-Check $python @('evaluation/run.py', '--cases', 'evaluation/cases/development.jsonl', '--validate-only')
    Invoke-Check $python @('-m', 'scripts.check_evaluation')
    Push-Location (Join-Path $projectRoot 'frontend')
    try {
        Invoke-Check 'npm.cmd' @('test')
        Invoke-Check 'npm.cmd' @('run', 'build')
        if ($Browser) {
            Invoke-Check 'npm.cmd' @('run', 'test:e2e')
            Invoke-Check 'npm.cmd' @('run', 'test:api')
        }
    } finally { Pop-Location }
} finally { Pop-Location }
Write-Output 'Credential-free checks passed. Live provider and Atlas verification remain separate.'
