# Windows counterpart of build.sh: builds the oxgl ANGLE bundle for windows-x64.
#   pwsh angle/build.ps1 fetch|build|bundle|all
# Needs Visual Studio 2022 with the Windows SDK, Git, and Python 3.11+.
param([Parameter(Mandatory)][ValidateSet('fetch', 'build', 'bundle', 'all')][string]$Command)
$ErrorActionPreference = 'Stop'

$here = $PSScriptRoot
$work = if ($env:OXGL_ANGLE_WORK) { $env:OXGL_ANGLE_WORK } else { Join-Path $env:LOCALAPPDATA 'oxgl\angle-build' }
function Pin($key) { (Select-String -Path "$here\pin.toml" -Pattern "^$key\s*=\s*`"([^`"]*)`"").Matches[0].Groups[1].Value }
$angleCommit = Pin 'angle_commit'
$depotToolsCommit = Pin 'depot_tools_commit'
$bundleVersion = Pin 'bundle_version'
$platform = 'windows-x64'
$out = Join-Path $work "angle\out\oxgl-$platform"

$env:PATH = "$work\depot_tools;$env:PATH"
$env:DEPOT_TOOLS_UPDATE = '0'
$env:DEPOT_TOOLS_WIN_TOOLCHAIN = '0'

function Invoke-Checked { & $args[0] $args[1..($args.Count - 1)]; if ($LASTEXITCODE) { throw "$($args -join ' ') failed ($LASTEXITCODE)" } }

function Fetch {
  New-Item -ItemType Directory -Force $work | Out-Null
  if (-not (Test-Path "$work\depot_tools")) { Invoke-Checked git clone https://chromium.googlesource.com/chromium/tools/depot_tools "$work\depot_tools" }
  Invoke-Checked git -C "$work\depot_tools" fetch --quiet origin
  Invoke-Checked git -C "$work\depot_tools" checkout --quiet $depotToolsCommit
  if (-not (Test-Path "$work\angle\.git")) { Invoke-Checked git clone https://chromium.googlesource.com/angle/angle "$work\angle" }
  Invoke-Checked git -C "$work\angle" fetch --quiet origin $angleCommit
  Invoke-Checked git -C "$work\angle" checkout --quiet --force $angleCommit
  Push-Location "$work\angle"
  try {
    Invoke-Checked python scripts/bootstrap.py
    Invoke-Checked gclient.bat sync -D --force --no-history --jobs 16
  } finally { Pop-Location }
}

function Build {
  New-Item -ItemType Directory -Force $out | Out-Null
  (Get-Content "$here\args\common.gn") + (Get-Content "$here\args\$platform.gn") | Set-Content "$out\args.gn"
  $targets = (Get-Content "$here\args\targets.txt") -split '\s+' | Where-Object { $_ }
  Push-Location "$work\angle"
  try {
    Invoke-Checked gn.bat gen $out
    Invoke-Checked autoninja.bat -C $out @targets
  } finally { Pop-Location }
}

function Bundle {
  Invoke-Checked python "$here\scripts\bundle.py" $platform $out "$work\angle" "$work\dist" $bundleVersion $angleCommit
}

switch ($Command) {
  'fetch' { Fetch }
  'build' { Build }
  'bundle' { Bundle }
  'all' { Fetch; Build; Bundle }
}
