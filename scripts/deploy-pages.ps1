# 一键发布到 GitHub Pages（gh-pages 分支模式）
# 用法: pwsh ./scripts/deploy-pages.ps1 [-Message 'update']
param([string]$Message = 'pages: build')

$ErrorActionPreference = 'Stop'
$repo = 'https://github.com/mmuu1987/dashline.git'

pnpm --filter @dashline/client exec vite build --base=./
if ($LASTEXITCODE -ne 0) { throw 'build failed' }

$tmp = Join-Path $env:TEMP 'dashline-ghpages'
if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
New-Item -ItemType Directory $tmp | Out-Null
Copy-Item (Join-Path $PSScriptRoot '..\apps\client\dist\*') $tmp -Recurse

Push-Location $tmp
try {
  git init -b gh-pages 2>$null | Out-Null
  git remote add origin $repo 2>$null
  git add -A
  git commit -m $Message 2>$null | Out-Null
  git push origin gh-pages --force
} finally { Pop-Location }

Write-Host "`n✅ 已发布: https://mmuu1987.github.io/dashline/ （Pages 生效约需 ~1 分钟）"
