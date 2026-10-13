# Device enumeration adapted from the user-provided FishAudioTTS v1.7.3 plugin.
param(
  [ValidateSet('list','play','tone')][string]$Mode = 'list',
  [string]$DeviceId = 'auto',
  [int]$Volume = 100
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)

# Windows PowerShell 5.1 / WinRT audio helper.
# Audio is kept in memory; no MP3/WAV files are created.
[Windows.Media.Devices.MediaDevice, Windows.Media, ContentType=WindowsRuntime] | Out-Null
[Windows.Devices.Enumeration.DeviceInformation, Windows.Devices.Enumeration, ContentType=WindowsRuntime] | Out-Null
[Windows.Devices.Enumeration.DeviceInformationCollection, Windows.Devices.Enumeration, ContentType=WindowsRuntime] | Out-Null
[Windows.Media.Playback.MediaPlayer, Windows.Media.Playback, ContentType=WindowsRuntime] | Out-Null
[Windows.Media.Core.MediaSource, Windows.Media.Core, ContentType=WindowsRuntime] | Out-Null
[Windows.Storage.Streams.InMemoryRandomAccessStream, Windows.Storage.Streams, ContentType=WindowsRuntime] | Out-Null
[Windows.Storage.Streams.DataWriter, Windows.Storage.Streams, ContentType=WindowsRuntime] | Out-Null
Add-Type -AssemblyName System.Runtime.WindowsRuntime

function Wait-WinRT {
  param(
    [Parameter(Mandatory=$true)]$Operation,
    [string]$Label = 'WinRT operation'
  )

  if ($null -eq $Operation) { throw "$Label returned null." }

  # Do not use System.WindowsRuntimeSystemExtensions.AsTask here.
  # DataWriterStoreOperation is an IAsyncOperation<uint> and PowerShell 5.1's
  # reflection-based AsTask overload selection is unreliable for this type.
  # All WinRT async operations expose Status/GetResults through IAsyncInfo.
  $deadline = [DateTime]::UtcNow.AddSeconds(30)
  while ($true) {
    $status = $Operation.Status
    switch ([int]$status) {
      0 { # Started
        if ([DateTime]::UtcNow -ge $deadline) {
          try { $Operation.Cancel() } catch {}
          throw "$Label timed out."
        }
        Start-Sleep -Milliseconds 10
        continue
      }
      1 { # Completed
        try { return $Operation.GetResults() } catch { throw "$Label completed but GetResults failed: $($_.Exception.Message)" }
      }
      2 { throw "$Label was cancelled." }
      3 {
        $detail = ''
        try { $detail = [string]$Operation.ErrorCode } catch {}
        if ($detail) { throw "$Label failed. ErrorCode=$detail" }
        throw "$Label failed."
      }
      default { throw "$Label returned unknown async status $status." }
    }
  }
}


# FindAllAsync enumeration worked with the standard PowerShell WinRT AsTask
# projection in the previous build. Keep that bridge for enumeration only;
# the direct Status/GetResults path is reserved for operations that were
# failing through AsTask (notably DataWriter.StoreAsync).
$asTaskFindAll = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
} | Select-Object -First 1)
function Find-All-AudioDevices {
  param([string]$Selector)
  if (-not $asTaskFindAll) { throw 'Windows Runtime AsTask bridge is unavailable for device enumeration.' }
  $op = [Windows.Devices.Enumeration.DeviceInformation]::FindAllAsync($Selector)
  $method = $asTaskFindAll.MakeGenericMethod([Windows.Devices.Enumeration.DeviceInformationCollection])
  $task = $method.Invoke($null, @($op))
  $task.Wait(-1) | Out-Null
  return $task.Result
}

function Get-AudioDevices {
  $selector = [Windows.Media.Devices.MediaDevice]::GetAudioRenderSelector()
  $collection = Find-All-AudioDevices $selector
  $out = @()
  foreach ($d in $collection) {
    if ($d.IsEnabled) {
      $out += [pscustomobject]@{
        id = [string]$d.Id
        name = [string]$d.Name
      }
    }
  }
  return $out
}

if ($Mode -eq 'list') {
  $devices = @(Get-AudioDevices)
  if ($devices.Count -eq 0) { '[]' } else { $devices | ConvertTo-Json -Compress }
  exit 0
}
