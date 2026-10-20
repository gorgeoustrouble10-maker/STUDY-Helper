$ErrorActionPreference = 'Stop'
$blogRoot = Split-Path -Parent $PSScriptRoot
$phoneRoot = Join-Path $blogRoot 'apps/study-board'
$runtimeNode = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
if (-not (Test-Path -LiteralPath $runtimeNode)) { $runtimeNode = (Get-Command node.exe).Source }
$logs = Join-Path $blogRoot '.local-mobile'
New-Item -ItemType Directory -Force -Path $logs | Out-Null
Push-Location $blogRoot
try {
    & $runtimeNode 'scripts/prepare-mobile.mjs'
    if ($LASTEXITCODE -ne 0) { throw '数据库准备失败，服务未启动。' }
} finally { Pop-Location }
$addresses = [System.Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces() | Where-Object { $_.OperationalStatus -eq 'Up' } | ForEach-Object { $_.GetIPProperties().UnicastAddresses } | Where-Object { $_.Address.AddressFamily -eq 'InterNetwork' -and $_.Address.ToString() -match '^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)' } | ForEach-Object { $_.Address.ToString() }
$address = $addresses | Select-Object -First 1
if (-not $address) { throw '未找到局域网 IPv4 地址，请先连接 Wi-Fi。' }
function Test-LocalPort([int]$Port) {
    $client = New-Object System.Net.Sockets.TcpClient
    try { $client.Connect('127.0.0.1', $Port); return $true } catch { return $false } finally { $client.Dispose() }
}
$running = @()
$env:PORT = '3002'
if (Test-LocalPort 3002) {
    Write-Host '端口 3002 已被占用，未启动另一个博客。请确认现有服务使用 npm run dev:lan。'
} else {
    $blogProcess = Start-Process -FilePath $runtimeNode -ArgumentList 'scripts/dev-lan.mjs' -WorkingDirectory $blogRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logs 'blog.log') -RedirectStandardError (Join-Path $logs 'blog-error.log') -PassThru
    $running += @{ role = 'blog'; pid = $blogProcess.Id }
}
$env:EXPO_NO_TELEMETRY = '1'
$env:REACT_NATIVE_PACKAGER_HOSTNAME = $address
$env:EXPO_PUBLIC_BLOG_URL = "http://${address}:3002"
if (Test-LocalPort 8082) {
    Write-Host '端口 8082 已被占用，未重复启动 Expo。'
} else {
    $phoneProcess = Start-Process -FilePath $runtimeNode -ArgumentList 'node_modules/expo/bin/cli','start','--lan','--port','8082' -WorkingDirectory $phoneRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logs 'expo.log') -RedirectStandardError (Join-Path $logs 'expo-error.log') -PassThru
    $running += @{ role = 'expo'; pid = $phoneProcess.Id }
}
@{ startedAt = (Get-Date).ToString('o'); address = $address; processes = $running } | ConvertTo-Json -Depth 4 | Set-Content -Encoding UTF8 -LiteralPath (Join-Path $logs 'session.json')
Write-Host "电脑设置页：http://127.0.0.1:3002/workspace/settings"
Write-Host "手机博客地址：http://${address}:3002"
Write-Host "Expo Go 地址：exp://${address}:8082"
Write-Host "启动日志：$logs"
Write-Host '请等待服务启动完成。手机连接同一 Wi-Fi；本脚本没有修改防火墙。'
