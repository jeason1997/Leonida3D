# Copies the single shared asset tree into Unity's StreamingAssets.
# Run this before building a Windows/Android player (the editor can use web/site/assets directly).
$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$src = Join-Path $repo "web\site\assets"
$dst = Join-Path $repo "unity\Assets\StreamingAssets\leonida\assets"

if (!(Test-Path (Join-Path $src "manifest.json"))) {
    throw "Missing shared assets: $src"
}

New-Item -ItemType Directory -Force (Split-Path -Parent $dst) | Out-Null
Write-Host "Syncing $src"
Write-Host "     -> $dst"
robocopy $src $dst /MIR /NFL /NDL /NJH /NJS /NP /R:1 /W:1 | Out-Null
if ($LASTEXITCODE -ge 8) {
    throw "robocopy failed with exit code $LASTEXITCODE"
}
Write-Host "Assets synced."
