param(
  [string]$OutputRoot = "dist/windows-portable",
  [string]$PortableFolderName = "ZooCutePortable"
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$outputRootPath = Join-Path $repoRoot $OutputRoot
$portableRootPath = Join-Path $outputRootPath $PortableFolderName
$portableDataPath = Join-Path $portableRootPath "zoo_data"
$portablePluginsPath = Join-Path $portableDataPath "plugins"
$portableExePath = Join-Path $portableRootPath "ZooCutePortable.exe"
$portableZipPath = Join-Path $outputRootPath "ZooCutePortable-win-x64.zip"
$releaseExePath = Join-Path $repoRoot "src-tauri\target\release\zoocute.exe"

Write-Host "Building portable executable via Tauri..."
Push-Location $repoRoot
try {
  npx tauri build --config src-tauri/tauri.portable.conf.json --no-bundle --ci
} finally {
  Pop-Location
}

if (-not (Test-Path $releaseExePath)) {
  throw "Expected release executable was not found: $releaseExePath"
}

if (Test-Path $portableRootPath) {
  Remove-Item -LiteralPath $portableRootPath -Recurse -Force
}

if (Test-Path $portableZipPath) {
  Remove-Item -LiteralPath $portableZipPath -Force
}

New-Item -ItemType Directory -Path $portablePluginsPath -Force | Out-Null
Copy-Item -LiteralPath $releaseExePath -Destination $portableExePath -Force
Compress-Archive -LiteralPath $portableRootPath -DestinationPath $portableZipPath -Force

Write-Host "Portable folder: $portableRootPath"
Write-Host "Portable zip: $portableZipPath"
