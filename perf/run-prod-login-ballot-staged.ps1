$ErrorActionPreference = "Stop"

$baseUrl = "https://vr-api-production.up.railway.app"
$scriptPath = ".\k6-login-ballot-readonly.js"
$stages = @(25, 50, 75, 100, 150)
$results = @()

foreach ($vus in $stages) {
  $summaryPath = ".\prod-login-ballot-summary-$vus.json"
  Write-Host "=== Running stage $vus VUs ==="

  & "C:\Program Files\k6\k6.exe" run $scriptPath `
    -e "BASE_URL=$baseUrl" `
    -e "VUS=$vus" `
    --summary-export $summaryPath

  $summary = Get-Content $summaryPath -Raw | ConvertFrom-Json
  $metrics = $summary.metrics

  $result = [PSCustomObject]@{
    vus = $vus
    login_success_rate = [double]$metrics.login_success_rate.value
    ballot_success_rate = [double]$metrics.ballot_success_rate.value
    http_req_failed = [double]$metrics.http_req_failed.value
    http_req_duration_p95 = [double]$metrics.http_req_duration.'p(95)'
    flow_p95 = [double]$metrics.readonly_flow_duration.'p(95)'
  }

  $results += $result
  $result | ConvertTo-Json -Depth 4

  Start-Sleep -Seconds 20
}

$results | ConvertTo-Json -Depth 4
