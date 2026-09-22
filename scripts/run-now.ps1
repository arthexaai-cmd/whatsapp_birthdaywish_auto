# Manual local trigger -- bypasses GitHub entirely. Use this if you're at
# the laptop and just want to run the bot immediately, or to test.
#
# Usage:
#   .\scripts\run-now.ps1                 # real run
#   .\scripts\run-now.ps1 -DryRun         # schedule only, sends nothing
#   .\scripts\run-now.ps1 -Date 2026-03-14  # pretend "today" is this date
#   .\scripts\run-now.ps1 -IgnoreLedger   # resend even if already recorded (testing only)

param(
    [switch]$DryRun,
    [string]$Date,
    [switch]$IgnoreLedger
)

$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

if ($DryRun) { $env:DRY_RUN = "true" }

$nodeArgs = @("src/index.js")
if ($Date) { $nodeArgs += "--date=$Date" }
if ($IgnoreLedger) { $nodeArgs += "--ignore-ledger" }

node @nodeArgs
exit $LASTEXITCODE
