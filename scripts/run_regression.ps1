param([Parameter(ValueFromRemainingArguments=$true)][string[]]$HarnessArgs)
$ErrorActionPreference = 'Stop'
$PythonCommand = if ($env:HARNESS_PYTHON) { $env:HARNESS_PYTHON } else { 'python' }
& $PythonCommand (Join-Path $PSScriptRoot 'harness.py') run @HarnessArgs
exit $LASTEXITCODE
