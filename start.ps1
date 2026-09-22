param([int]$Port = 8000)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$pythonPath = Join-Path $PSScriptRoot '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $pythonPath)) {
    throw 'Chua co .venv. Xem README.md de cai dat.'
}
Write-Host "Embedding Lab: http://127.0.0.1:$Port"
& $pythonPath -m uvicorn lab.app:app --host 127.0.0.1 --port $Port
