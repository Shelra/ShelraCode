#!/usr/bin/env pwsh
# ShelraCode installer for Windows (Windows PowerShell 5.1 or PowerShell 7).
#
#   irm https://www.shelra.dev/install.ps1 | iex
#
# (The www host, not the apex: shelra.dev answers with a 308 redirect, which Windows PowerShell 5.1
# does not follow.)
#
# Installs the latest GitHub release of the shelra CLI into %USERPROFILE%\.shelra\bin, checks its
# SHA-256 against the release's checksums.txt, records the install so that `shelra update` and
# `shelra uninstall` work, and adds the folder to the user PATH. While no release is published it
# builds the CLI from the repository's main branch with Bun instead (installing Bun when missing).
#
# Options: parameters when run from a file, environment variables when piped into iex.
#   -Version 1.1.7      SHELRA_VERSION=1.1.7        a specific release instead of the latest
#   -InstallDir <dir>   SHELRA_INSTALL_BIN=<dir>    another folder for shelra.exe
#   -NoModifyPath       SHELRA_NO_MODIFY_PATH=1     leave the user PATH alone
#   -NoSourceBuild      SHELRA_NO_SOURCE_BUILD=1    fail instead of building from source
#
# The macOS and Linux equivalent is install.sh at the repository root.
param(
  [string]$Version = "",
  [string]$InstallDir = "",
  [switch]$NoModifyPath,
  [switch]$NoSourceBuild
)

$ErrorActionPreference = "Stop"

$ShelraRepo = "Shelra/ShelraCode"
$ShelraReleasesApi = if ($env:SHELRA_RELEASES_API) { $env:SHELRA_RELEASES_API.TrimEnd("/") } else { "https://api.github.com/repos/$ShelraRepo/releases" }
$ShelraSourceZip = if ($env:SHELRA_SOURCE_ZIP) { $env:SHELRA_SOURCE_ZIP } else { "https://github.com/$ShelraRepo/archive/refs/heads/main.zip" }
$ShelraTarget = "windows-x64"
$ShelraAssetName = "shelra-windows-x64.exe"
$ShelraBinaryName = "shelra.exe"
$ShelraHttpHeaders = @{ "User-Agent" = "shelra-install"; "Accept" = "application/vnd.github+json" }

if (-not $Version -and $env:SHELRA_VERSION) { $Version = $env:SHELRA_VERSION }
$Version = ($Version -replace "^shelra@", "") -replace "^v", ""
$ShelraModifyPath = -not ($NoModifyPath -or $env:SHELRA_NO_MODIFY_PATH -eq "1")
$ShelraSourceBuild = -not ($NoSourceBuild -or $env:SHELRA_NO_SOURCE_BUILD -eq "1")
$ShelraUserHome = if ($env:USERPROFILE) { $env:USERPROFILE } else { $HOME }
$ShelraUserDir = Join-Path $ShelraUserHome ".shelra"
if (-not $InstallDir) { $InstallDir = if ($env:SHELRA_INSTALL_BIN) { $env:SHELRA_INSTALL_BIN } else { Join-Path $ShelraUserDir "bin" } }
$ShelraInstallDir = [IO.Path]::GetFullPath($InstallDir)
$ShelraBinaryPath = Join-Path $ShelraInstallDir $ShelraBinaryName
$ShelraMetadataPath = Join-Path $ShelraUserDir "install.json"

function Write-ShelraStep([string]$Message) {
  Write-Host "  $Message"
}

function Get-ShelraRelease([string]$Wanted) {
  $url = if ($Wanted) { "$ShelraReleasesApi/tags/shelra@$Wanted" } else { "$ShelraReleasesApi/latest" }
  try {
    return Invoke-RestMethod -Uri $url -Headers $ShelraHttpHeaders -TimeoutSec 30
  } catch {
    $status = 0
    try { $status = [int]$_.Exception.Response.StatusCode } catch { $status = 0 }
    if ($status -eq 404) { return $null }
    throw "GitHub did not answer for $url ($($_.Exception.Message))"
  }
}

function Save-ShelraDownload([string]$Url, [string]$Path) {
  Invoke-WebRequest -Uri $Url -OutFile $Path -Headers @{ "User-Agent" = "shelra-install" } -UseBasicParsing -TimeoutSec 900
}

function Test-ShelraChecksum([string]$File, [string]$ChecksumFile, [string]$Name) {
  $expected = $null
  foreach ($line in (Get-Content -Path $ChecksumFile)) {
    $parts = $line.Trim() -split "\s+", 2
    if ($parts.Count -eq 2 -and ($parts[1] -eq $Name -or $parts[1] -eq "*$Name")) { $expected = $parts[0].ToLower() }
  }
  if (-not $expected) { throw "checksums.txt has no entry for $Name" }
  $actual = (Get-FileHash -Path $File -Algorithm SHA256).Hash.ToLower()
  if ($actual -ne $expected) { throw "checksum mismatch for $Name (expected $expected, got $actual)" }
}

function Get-ShelraBun {
  $found = Get-Command bun.exe -ErrorAction SilentlyContinue
  if ($found) { return $found.Source }
  $local = Join-Path $ShelraUserHome ".bun\bin\bun.exe"
  if (Test-Path -Path $local) { return $local }
  Write-ShelraStep "Bun is not installed: installing it with the official installer from bun.sh ..."
  & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "irm https://bun.sh/install.ps1 | iex" | Out-Host
  if (Test-Path -Path $local) { return $local }
  throw "Bun did not install; install it from https://bun.sh and run this installer again"
}

function Build-ShelraFromSource([string]$Bun, [string]$Tmp) {
  $zip = Join-Path $Tmp "source.zip"
  Write-ShelraStep "Downloading the source of the main branch ..."
  Save-ShelraDownload $ShelraSourceZip $zip
  $root = Join-Path $Tmp "source"
  Expand-Archive -Path $zip -DestinationPath $root -Force
  $src = Get-ChildItem -Path $root -Directory | Select-Object -First 1
  if (-not $src) { throw "the source archive is empty" }
  $previousHusky = $env:HUSKY
  $previousSkip = $env:SHELRA_BUILD_SKIP_INSTALL
  Push-Location $src.FullName
  try {
    $env:HUSKY = "0"
    $env:SHELRA_BUILD_SKIP_INSTALL = "1"
    # Their output goes straight to the console: anything left on the pipeline would become part of
    # this function's return value, which is the path of the built executable.
    Write-ShelraStep "Installing dependencies with Bun (a few minutes) ..."
    & $Bun install --frozen-lockfile | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "bun install failed ($LASTEXITCODE)" }
    Write-ShelraStep "Compiling shelra.exe ..."
    & $Bun run scripts/build.ts | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "the build failed ($LASTEXITCODE)" }
  } finally {
    Pop-Location
    $env:HUSKY = $previousHusky
    $env:SHELRA_BUILD_SKIP_INSTALL = $previousSkip
  }
  $exe = Join-Path $src.FullName "dist\shelra.exe"
  if (-not (Test-Path -Path $exe)) { throw "the build produced no dist\shelra.exe" }
  return $exe
}

function Install-ShelraBinary([string]$Source) {
  New-Item -ItemType Directory -Path $ShelraInstallDir -Force | Out-Null
  New-Item -ItemType Directory -Path $ShelraUserDir -Force | Out-Null
  $staged = Join-Path $ShelraInstallDir (".shelra.exe.installing-" + [Guid]::NewGuid().ToString("N"))
  Copy-Item -Path $Source -Destination $staged -Force
  try {
    if (Test-Path -Path $ShelraBinaryPath) {
      $previous = "$ShelraBinaryPath.previous"
      if (Test-Path -Path $previous) { Remove-Item -Path $previous -Force }
      Move-Item -Path $ShelraBinaryPath -Destination $previous -Force
    }
    Move-Item -Path $staged -Destination $ShelraBinaryPath -Force
  } catch {
    throw "cannot replace $ShelraBinaryPath; close every running shelra window and run the installer again ($($_.Exception.Message))"
  } finally {
    if (Test-Path -Path $staged) { Remove-Item -Path $staged -Force -ErrorAction SilentlyContinue }
  }
  try { Unblock-File -Path $ShelraBinaryPath -ErrorAction SilentlyContinue } catch { }
}

function Get-ShelraInstalledVersion {
  try {
    $output = (& $ShelraBinaryPath --version 2>$null | Out-String).Trim()
    if ($output) { return ($output -split "\s+")[-1] }
  } catch { }
  return "unknown"
}

function Write-ShelraMetadata([string]$InstalledVersion) {
  $metadata = [ordered]@{
    schemaVersion = 1
    installMethod = "script"
    version = $InstalledVersion
    repo = $ShelraRepo
    binaryPath = $ShelraBinaryPath
    installDir = $ShelraInstallDir
    assetName = $ShelraAssetName
    target = $ShelraTarget
    installedAt = [DateTime]::UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ")
    shellConfigPath = $null
    pathCommand = $null
  }
  $json = ($metadata | ConvertTo-Json -Depth 3) + "`n"
  [IO.File]::WriteAllText($ShelraMetadataPath, $json, (New-Object System.Text.UTF8Encoding($false)))
}

# Adds the install folder to the user PATH (keeping the registry value's kind, so %VAR% entries
# survive) and tells running programs about it, then to this session.
function Add-ShelraUserPath([string]$Dir) {
  $entry = $Dir.TrimEnd("\")
  $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey("Environment", $true)
  try {
    $kind = [Microsoft.Win32.RegistryValueKind]::ExpandString
    $current = ""
    if ($key.GetValueNames() -contains "Path") {
      $kind = $key.GetValueKind("Path")
      $current = [string]$key.GetValue("Path", "", [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
    }
    $items = New-Object System.Collections.Generic.List[string]
    foreach ($item in $current.Split(";")) {
      $trimmed = $item.Trim()
      if ($trimmed.Length -gt 0 -and -not $items.Contains($trimmed)) { $items.Add($trimmed) }
    }
    $present = $false
    foreach ($item in $items) { if ($item.TrimEnd("\") -ieq $entry) { $present = $true } }
    if (-not $present) {
      $items.Add($entry)
      $key.SetValue("Path", ($items -join ";"), $kind)
      $script:ShelraPathChanged = $true
    }
  } finally {
    $key.Close()
  }
  if ($script:ShelraPathChanged) {
    try {
      if (-not ("ShelraInstall.Native" -as [type])) {
        Add-Type -Namespace ShelraInstall -Name Native -MemberDefinition @"
[System.Runtime.InteropServices.DllImport("user32.dll", SetLastError = true, CharSet = System.Runtime.InteropServices.CharSet.Auto)]
public static extern System.IntPtr SendMessageTimeout(System.IntPtr hWnd, uint Msg, System.UIntPtr wParam, string lParam, uint fuFlags, uint uTimeout, out System.UIntPtr lpdwResult);
"@
      }
      $result = [UIntPtr]::Zero
      [ShelraInstall.Native]::SendMessageTimeout([IntPtr]0xffff, 0x001A, [UIntPtr]::Zero, "Environment", 2, 5000, [ref]$result) | Out-Null
    } catch { }
  }
  $inSession = $false
  foreach ($item in $env:Path.Split(";")) { if ($item.TrimEnd("\") -ieq $entry) { $inSession = $true } }
  if (-not $inSession) { $env:Path = "$entry;$env:Path" }
}

function Invoke-ShelraInstall {
  Write-Host ""
  Write-Host "ShelraCode installer" -ForegroundColor Green
  if ($env:OS -ne "Windows_NT") { throw "this installer is for Windows; on macOS or Linux use install.sh from the repository" }
  if ($PSVersionTable.PSVersion.Major -lt 5) { throw "PowerShell 5.1 or later is required" }
  $arch = $env:PROCESSOR_ARCHITEW6432
  if (-not $arch) { $arch = $env:PROCESSOR_ARCHITECTURE }
  if ($arch -ne "AMD64" -and $arch -ne "ARM64") { throw "unsupported architecture $arch (64-bit Windows is required)" }
  if ($arch -eq "ARM64") { Write-ShelraStep "Windows on ARM: the x64 build runs through emulation." }
  try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
  } catch { }

  $tmp = Join-Path ([IO.Path]::GetTempPath()) ("shelra-install-" + [Guid]::NewGuid().ToString("N").Substring(0, 8))
  New-Item -ItemType Directory -Path $tmp -Force | Out-Null
  $script:ShelraPathChanged = $false
  try {
    $source = $null
    $releaseVersion = ""
    $release = Get-ShelraRelease $Version
    if ($release) {
      $tag = [string]$release.tag_name
      $releaseVersion = ($tag -replace "^shelra@", "") -replace "^v", ""
      $asset = @($release.assets | Where-Object { $_.name -eq $ShelraAssetName }) | Select-Object -First 1
      $sums = @($release.assets | Where-Object { $_.name -eq "checksums.txt" }) | Select-Object -First 1
      if (-not $asset -or -not $sums) { throw "release $tag has no $ShelraAssetName or checksums.txt" }
      Write-ShelraStep "Downloading ShelraCode $releaseVersion ($ShelraAssetName) ..."
      $source = Join-Path $tmp $ShelraAssetName
      Save-ShelraDownload $asset.browser_download_url $source
      $sumsFile = Join-Path $tmp "checksums.txt"
      Save-ShelraDownload $sums.browser_download_url $sumsFile
      Test-ShelraChecksum $source $sumsFile $ShelraAssetName
      Write-ShelraStep "Checksum verified."
    } elseif ($Version) {
      throw "release shelra@$Version was not found at https://github.com/$ShelraRepo/releases"
    } elseif (-not $ShelraSourceBuild) {
      throw "no release is published yet at https://github.com/$ShelraRepo/releases, and building from source is disabled"
    } else {
      Write-ShelraStep "No release is published yet: building ShelraCode from the source of the main branch."
      $bun = Get-ShelraBun
      $source = Build-ShelraFromSource $bun $tmp
    }

    Install-ShelraBinary $source
    $installed = Get-ShelraInstalledVersion
    if ($installed -eq "unknown" -and $releaseVersion) { $installed = $releaseVersion }
    Write-ShelraMetadata $installed
    if ($ShelraModifyPath) { Add-ShelraUserPath $ShelraInstallDir }

    Write-Host ""
    Write-Host "ShelraCode $installed installed to $ShelraBinaryPath" -ForegroundColor Green
    if ($script:ShelraPathChanged) {
      Write-ShelraStep "$ShelraInstallDir was added to your user PATH: this window can use shelra now, others after reopening."
    } elseif (-not $ShelraModifyPath) {
      Write-ShelraStep "PATH left unchanged: add $ShelraInstallDir to it, or run $ShelraBinaryPath."
    }
    Write-Host ""
    Write-Host "  Run:        shelra"
    Write-Host "  Update:     shelra update"
    Write-Host "  Uninstall:  shelra uninstall"
    Write-Host ""
  } finally {
    Remove-Item -Path $tmp -Recurse -Force -ErrorAction SilentlyContinue
  }
}

$ShelraPreviousProgress = $ProgressPreference
$ProgressPreference = "SilentlyContinue"
$ShelraFailed = $false
try {
  Invoke-ShelraInstall
} catch {
  $ShelraFailed = $true
  Write-Host ""
  Write-Host "ShelraCode was not installed: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "  Help: https://github.com/$ShelraRepo#install"
  Write-Host ""
} finally {
  $ProgressPreference = $ShelraPreviousProgress
}
if ($ShelraFailed -and $PSCommandPath) { exit 1 }
