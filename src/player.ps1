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
$player = $null
$source = $null
try {
    $player = New-Object Windows.Media.Playback.MediaPlayer
    $player.Volume = [double]::Parse($env:GIRO_AUDIO_VOLUME, [Globalization.CultureInfo]::InvariantCulture)
    $player.AudioCategory = [Windows.Media.Playback.MediaPlayerAudioCategory]::Media
    $device = Get-RenderDevice $env:GIRO_AUDIO_DEVICE
    if ($null -ne $device) { $player.AudioDevice = $device }
    $source = [Windows.Media.Core.MediaSource]::CreateFromUri([Uri]$env:GIRO_AUDIO_URL)
    $player.Source = $source
    [Console]::Out.WriteLine('PREPARED')
    [Console]::Out.Flush()
    if ([Console]::In.ReadLine() -ne 'GO') { throw 'Playback cancelled before starting.' }
    $player.Play()
    $started = $false
    $deadline = [DateTime]::UtcNow.AddSeconds(18)
    while ($true) {
        $state = $player.PlaybackSession.PlaybackState.ToString()
        if ($state -eq 'Playing' -or (-not $started -and $player.PlaybackSession.Position.TotalMilliseconds -gt 0)) {
            if (-not $started) { $started = $true; [Console]::Out.WriteLine('READY'); [Console]::Out.Flush() }
        } elseif ($started -and ($state -eq 'None' -or $state -eq 'Paused')) {
            break
        }
        if (-not $started -and [DateTime]::UtcNow -ge $deadline) {
            throw 'Windows could not start this audio stream. Check the selected output and sound format.'
        }
        Start-Sleep -Milliseconds 50
    }
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
} finally {
    if ($null -ne $player) { try { $player.Pause() } catch {}; try { $player.Dispose() } catch {} }
    if ($null -ne $source) { try { $source.Dispose() } catch {} }
}
exit 0
