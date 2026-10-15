# WinRT device enumeration and AudioDevice routing adapted from the user's
# working FishAudioTTS v1.7.3 plugin. Audio remains streamed through localhost.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.Playback.MediaPlayer,Windows.Media.Playback,ContentType=WindowsRuntime]
$null = [Windows.Media.Playback.MediaPlayerAudioCategory,Windows.Media.Playback,ContentType=WindowsRuntime]
$null = [Windows.Media.Core.MediaSource,Windows.Media.Core,ContentType=WindowsRuntime]
$null = [Windows.Media.Devices.MediaDevice,Windows.Media.Devices,ContentType=WindowsRuntime]
$null = [Windows.Devices.Enumeration.DeviceInformation,Windows.Devices.Enumeration,ContentType=WindowsRuntime]
$null = [Windows.Devices.Enumeration.DeviceInformationCollection,Windows.Devices.Enumeration,ContentType=WindowsRuntime]
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
} | Select-Object -First 1)
function Get-RenderDevice {
    param([string]$Id)
    if ([string]::IsNullOrWhiteSpace($Id) -or $Id -eq 'auto') { return $null }
    if (-not $asTaskGeneric) { throw 'Windows device enumeration bridge is unavailable.' }
    $selector = [Windows.Media.Devices.MediaDevice]::GetAudioRenderSelector()
    $op = [Windows.Devices.Enumeration.DeviceInformation]::FindAllAsync($selector)
    $method = $asTaskGeneric.MakeGenericMethod([Windows.Devices.Enumeration.DeviceInformationCollection])
    $task = $method.Invoke($null, @($op))
    if (-not $task.Wait(15000)) { throw 'Audio output enumeration timed out.' }
    foreach ($device in $task.Result) {
        if ([string]$device.Id -eq $Id -and $device.IsEnabled) { return $device }
    }
    throw 'Selected audio output is disconnected or disabled. Refresh outputs and choose another device.'
}
# ReadLine runs on a .NET worker, never blocks the media command loop.
Add-Type -TypeDefinition @'
using System;
using System.Threading.Tasks;
public static class GiroAudioInput {
 public static Task<string> Next() { return Task.Factory.StartNew(() => Console.In.ReadLine()); }
}
'@
$player = New-Object Windows.Media.Playback.MediaPlayer
$player.AudioCategory = [Windows.Media.Playback.MediaPlayerAudioCategory]::Media
$source = $null
$currentUrl = ''
$currentOutput = ''
$currentId = 0
$active = $false
$started = $false
$lastProgress = [DateTime]::MinValue
$parent = [Diagnostics.Process]::GetProcessById([int]$env:GIRO_PARENT_PID)
$read = [GiroAudioInput]::Next()
[Console]::Out.WriteLine('HOST_READY')
[Console]::Out.Flush()
try {
 while (-not $parent.HasExited) {
  if ($read.IsCompleted) {
   $line = $read.GetAwaiter().GetResult()
   if ($null -eq $line) { break }
   $read = [GiroAudioInput]::Next()
   try {
    $command = $line | ConvertFrom-Json
    $player.Pause()
    $active = $false
    $currentId = [long]$command.id
    if ($command.op -eq 'stop') {
     $player.Source = $null
     if ($null -ne $source) { $source.Dispose(); $source = $null }
     $currentUrl = ''
    } elseif ($command.op -eq 'play') {
     if ($currentOutput -ne [string]$command.output) {
      $player.AudioDevice = Get-RenderDevice ([string]$command.output)
      $currentOutput = [string]$command.output
     }
     $player.Volume = [double]$command.volume
     if ($currentUrl -ne [string]$command.url) {
      $player.Source = $null
      if ($null -ne $source) { $source.Dispose() }
      $source = [Windows.Media.Core.MediaSource]::CreateFromUri([Uri]$command.url)
      $player.Source = $source
      $currentUrl = [string]$command.url
     } else {
      # Browser-style restart: reuse the buffered source and seek to zero.
      if ($player.PlaybackSession.CanSeek) { $player.PlaybackSession.Position = [TimeSpan]::Zero }
     }
     $started = $false
     $active = $true
     $deadline = [DateTime]::UtcNow.AddSeconds(30)
     $player.Play()
    }
   } catch {
    $active = $false
    $currentUrl = ''
    [Console]::Out.WriteLine('ERROR:' + $currentId + ':' + $_.Exception.Message)
    [Console]::Out.Flush()
   }
  }
  if ($active) {
   $state = $player.PlaybackSession.PlaybackState.ToString()
   if ($state -eq 'Playing') { $started = $true }
   if ($started -and ([DateTime]::UtcNow - $lastProgress).TotalMilliseconds -ge 100) {
    $lastProgress = [DateTime]::UtcNow
    [Console]::Out.WriteLine('PROGRESS:' + $currentId + ':' + [long]$player.PlaybackSession.Position.TotalMilliseconds + ':' + [long]$player.PlaybackSession.NaturalDuration.TotalMilliseconds)
    [Console]::Out.Flush()
   }
   if (($started -and ($state -eq 'None' -or $state -eq 'Paused')) -or (-not $started -and [DateTime]::UtcNow -ge $deadline)) {
    $active = $false
    if (-not $started) { [Console]::Out.WriteLine('ERROR:' + $currentId + ':Windows could not start this audio stream.') }
    [Console]::Out.WriteLine('ENDED:' + $currentId)
    [Console]::Out.Flush()
   }
  }
  Start-Sleep -Milliseconds 5
 }
} finally {
 try { $player.Pause(); $player.Dispose() } catch {}
 if ($null -ne $source) { try { $source.Dispose() } catch {} }
 $parent.Dispose()
}
