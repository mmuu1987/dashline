# Publish the client build to gh-pages. -AllowForce is mandatory.
# Usage: powershell -File ./scripts/deploy-pages.ps1 -AllowForce [-Target <git-url>]
param(
  [string]$Message = 'pages: build',
  [string]$Target = '',
  [switch]$AllowForce
)

$ErrorActionPreference = 'Stop'

if (-not $AllowForce) {
  throw 'Publishing overwrites remote gh-pages. Pass -AllowForce after verifying the target.'
}

if ([string]::IsNullOrWhiteSpace($Target)) {
  $Target = (& git remote get-url origin).Trim()
  if ($LASTEXITCODE -ne 0) { throw 'Cannot read the current repository origin.' }
}
if ([string]::IsNullOrWhiteSpace($Target) -or $Target -match "[`r`n]") {
  throw 'Invalid Git deployment target.'
}
if ($Target -notmatch '^(https?://|ssh://|git@)\S+$') {
  throw "Unsupported Git deployment target: $Target"
}

$tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$tempDir = [IO.Path]::GetFullPath((Join-Path $tempRoot ("dashline-ghpages-" + [Guid]::NewGuid().ToString('N'))))
if (-not $tempDir.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Temporary deployment directory is outside the system temp directory.'
}

Write-Host "Deployment target: $Target"
pnpm --filter @dashline/client exec vite build --base=./
if ($LASTEXITCODE -ne 0) { throw 'build failed' }

New-Item -ItemType Directory -LiteralPath $tempDir | Out-Null
$locationPushed = $false
try {
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot '..\apps\client\dist') -Destination $tempDir -Recurse
  $deployRoot = Join-Path $tempDir 'dist'
  Push-Location -LiteralPath $deployRoot
  $locationPushed = $true

  git init -b gh-pages
  if ($LASTEXITCODE -ne 0) { throw 'git init failed' }
  git remote add origin $Target
  if ($LASTEXITCODE -ne 0) { throw 'git remote add failed' }
  git add -A
  git commit -m $Message
  if ($LASTEXITCODE -ne 0) { throw 'git commit failed' }
  git push origin gh-pages --force
  if ($LASTEXITCODE -ne 0) { throw 'git push failed' }
  Write-Host 'GitHub Pages deployment completed.'
} finally {
  if ($locationPushed) { Pop-Location }
  if (Test-Path -LiteralPath $tempDir) {
    $resolved = [IO.Path]::GetFullPath($tempDir)
    if ($resolved.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) {
      Remove-Item -LiteralPath $resolved -Recurse -Force
    }
  }
}
