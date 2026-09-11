$ErrorActionPreference = "Stop"

function Get-NormalizedPath([string]$Value) {
  if ([string]::IsNullOrWhiteSpace($Value)) {
    return ""
  }

  try {
    $expanded = [Environment]::ExpandEnvironmentVariables($Value.Trim().Trim('"'))
    return [System.IO.Path]::GetFullPath($expanded).TrimEnd('\', '/').ToLowerInvariant()
  }
  catch {
    return $Value.Trim().Trim('"').TrimEnd('\', '/').ToLowerInvariant()
  }
}

function Remove-ManagedSkill([string]$SkillsRoot) {
  $resolvedRoot = [System.IO.Path]::GetFullPath($SkillsRoot)
  $target = [System.IO.Path]::GetFullPath((Join-Path $resolvedRoot "navoke"))
  if ([System.IO.Path]::GetDirectoryName($target) -ne $resolvedRoot) {
    throw "Refusing to remove a skill outside the expected skills root."
  }

  $marker = Join-Path $target ".navoke-managed.json"
  if (-not (Test-Path -LiteralPath $marker -PathType Leaf)) {
    return
  }

  try {
    $metadata = Get-Content -LiteralPath $marker -Raw | ConvertFrom-Json
  }
  catch {
    return
  }

  if ($metadata.managedBy -eq "navoke") {
    Remove-Item -LiteralPath $target -Recurse -Force
  }
}

$codexSkillsRoot = Join-Path $HOME ".agents\skills"
$claudeSkillsRoot = Join-Path $HOME ".claude\skills"
Remove-ManagedSkill $codexSkillsRoot
Remove-ManagedSkill $claudeSkillsRoot

$navokeBin = [System.IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA "Navoke\bin"))
$launcher = Join-Path $navokeBin "navoke.cmd"
if (Test-Path -LiteralPath $launcher -PathType Leaf) {
  $launcherText = Get-Content -LiteralPath $launcher -Raw
  if ($launcherText -match "Managed by Navoke") {
    Remove-Item -LiteralPath $launcher -Force
  }
}

if ((Test-Path -LiteralPath $navokeBin -PathType Container) -and -not (Get-ChildItem -LiteralPath $navokeBin -Force | Select-Object -First 1)) {
  Remove-Item -LiteralPath $navokeBin -Force
}

$currentUserPath = [Environment]::GetEnvironmentVariable("Path", "User")
$normalizedBin = Get-NormalizedPath $navokeBin
$remainingEntries = @(
  $currentUserPath -split ";" |
    Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
    Where-Object { (Get-NormalizedPath $_) -ne $normalizedBin }
)
[Environment]::SetEnvironmentVariable("Path", ($remainingEntries -join ";"), "User")

Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class NavokeEnvironmentBroadcast {
  [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern IntPtr SendMessageTimeout(
    IntPtr hWnd,
    uint Msg,
    UIntPtr wParam,
    string lParam,
    uint fuFlags,
    uint uTimeout,
    out UIntPtr lpdwResult
  );
}
'@
$broadcastResult = [UIntPtr]::Zero
[void][NavokeEnvironmentBroadcast]::SendMessageTimeout(
  [IntPtr]0xffff,
  0x001A,
  [UIntPtr]::Zero,
  "Environment",
  0x0002,
  5000,
  [ref]$broadcastResult
)
