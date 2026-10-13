# Giro Soundboard Stream Deck Plugin

Version **0.6.5**. Official Stream Deck SDK 2.1.2; manifest SDKVersion 2.
Works with Stream Deck keypad buttons across device models. Requires Stream Deck 7.1+, Windows 10+ or macOS 12+. The bundled preconfigured profiles are optional layouts for the XL.

## Install and sign in

1. Install Giro-Soundboard-v0.6.5.streamDeckPlugin by double-clicking it.
   This updates the same Giro plugin; your existing profile can stay.
2. Drag Favorite Sound actions onto the buttons you want to use. XL owners can optionally import Giro-Soundboard-XL.streamDeckProfile.
3. Select any Giro key and enter https://dirtydeedsgaming.com:8443 (or your soundboard address).
4. Click **Sign in with Discord**. Your default browser opens the soundboard's secure login page.
5. Authorize the soundboard on Discord. The plugin connects automatically after Discord returns you to the soundboard.
6. Return to Stream Deck. Your account favorites populate automatically.

Sign-in goes directly through Discord OAuth, including when the soundboard is already signed in. No code or separate Connect confirmation is required.

Place Favorite Sound keys on the buttons you want populated. They automatically load favorites in key order. Add Previous/Next for paging and Stop for local playback.
Previous/Next Favorites always display their arrows and page count. A dimmed arrow is an inactive placeholder when there is no page in that direction.
The plugin never requests profile installation or switches profiles. Existing layouts are retained. Optional XL profiles for 1–29 favorites and a full XL layout are included in the download ZIP for manual import only. With ten favorites, import the ten-favorite layout or place ten Favorite Sound keys. Favorite changes update key labels; empty slots are blank.
Paging uses the number of Favorite Sound keys you have placed, so every favorite remains reachable in a custom layout. Click **Open main soundboard** in settings to manage favorites.

## Per-button sound and text

The **Sound for this button** dropdown starts with **Auto**, which keeps automatic favorite assignment. Choose any favorite to pin it to that button; pinned choices stay fixed when names/order or pages change.

**Button text** accepts an optional custom label, including manual line breaks. Leave it blank to use the sound's name. **Text size** adjusts the preferred size. Labels wrap and shrink to fit the key rather than cutting off the end of a long name.

Sound choice, custom text, text size, audio output, and push-to-talk settings are stored per button. Sign-in and playback volume are shared across the plugin.

## Windows audio outputs

Select **Audio output for this button** to route that key's sound to speakers, a headset, a virtual cable, or another enabled Windows render endpoint. **System default** follows Windows' default output. **Refresh outputs** reloads connected devices.

Enumeration and device assignment are adapted from the working FishAudioTTS v1.7.3 plugin supplied by the user: the WinRT AsTask bridge enumerates DeviceInformation objects, and MediaPlayer.AudioDevice receives the chosen device directly. The plugin does not change the Windows system default.

A disconnected or disabled selected device causes a playback error; it does not silently route audio to a different output. On macOS only System default is supported.

## Local / Squad / Off push to talk (Windows)

Choose the PTT mode for each sound button:

- **Local** holds the Local key while audio plays. Default: **K**.
- **Squad** holds the Squad key while audio plays. Default: **J**.
- **Off** plays audio without holding a key.

The default mode is **Local**. Both keys are editable. Letters, digits, F1–F24, and named keys such as Space, Ctrl, Shift, Enter, or Tab are supported. Key combinations are not supported.

The selected key goes down once before audio starts and stays held continuously, including across rapid sound restarts. It releases when playback finishes, when you press Stop, when playback fails, or when you switch to a different PTT key or Off. While held, the guardian repeats key-down approximately every 33–38 ms, producing repeated characters in a focused text editor. Repeats never insert key-up events. There are no recovery pulses or keyboard hooks. Tab and other keyboard keys do not trigger any PTT input. Wardogs menu behavior must be confirmed in the game. A separate scan-code key guardian handles release independently of the audio process and also releases the held key if the plugin process exits.

These controls select the game's PTT key; audio routing still uses your per-button output selection. Use the virtual audio output required by your game or voice setup. Actual game input acceptance must be checked on Windows.

## Local streaming

Sounds stream directly to the Stream Deck computer's selected audio output. No audio files are saved locally, and no soundboard browser tab needs to stay open.

The native player receives a private loopback streaming URL. An in-memory local proxy attaches the account credential when requesting audio from the soundboard, forwards byte-range requests, and pipes the response directly to the player.

Windows uses the WinRT MediaPlayer through a hidden PowerShell process; macOS uses AVPlayer. The plugin includes both scripts. MP3/WAV and other formats supported by your operating system can play; codec support depends on the OS.

The local volume slider applies to the next sound. On Windows, one persistent native player stays running. Repeated presses rewind the current buffered stream to the beginning, without recreating PowerShell, reopening the sound, waiting for play-history requests, or releasing PTT between presses. Selecting another sound replaces the current source in that same player. The first play still needs to open the stream; no sound files are saved to disk. On macOS, each press restarts the native player. Sounds never overlap. Rapid clicks cancel stale pending starts, so the latest press wins. Stop cancels playback and in-progress startup, including when the server is offline. Audio does not route through Discord in this version.

For Windows virtual audio routing, choose the virtual endpoint in the per-button audio dropdown.

## Credentials and sign-out

Discord login runs through the existing soundboard OAuth flow in your browser. The plugin never receives your Discord password, Discord OAuth secret, or browser session cookie. Its separate credential allows only your favorites, favorite audio, local play-request recording, and its own sign-out.

Plugin credentials are stored in Stream Deck global settings, not action/profile settings. They expire after 30 days. **Sign out** revokes the plugin credential when the server is reachable. Browser sign-out is separate.

Pending logins expire after ten minutes and use a one-time secret stored only in the plugin. Native authorization is granted by the cookie-bound Discord OAuth callback, never just by an existing browser login.

HTTPS is required for a remote server. HTTP is allowed only for localhost. Streaming redirects are rejected so credentials are not forwarded to another address.

## Server activation

Restart the soundboard after installing the new server routes:

    sudo systemctl restart discord-soundboard.service

If plugin settings report that a server update is needed, verify that this restart completed.

## Build and test

From the repository root, with Node.js 24+ and Python 3 available:

    npm ci
    npm run build
    npm test
    npm run package

Use your Node.js 24+ installation on Windows/macOS as appropriate.
Python builds the XL profile archive and plugin icon.

Tests cover browser authorization and OAuth return paths, native credential isolation and revocation, live favorites, ranged streaming through the loopback proxy, Stop cancellation, SDK key registration and paging, preservation of the typed URL while status polling runs, pinned favorites, saved key settings, custom label wrapping/XML escaping, device enumeration, selected-output propagation, PTT defaults and validation, key-down-before-audio sequencing, Stop and natural-end release, and Off-mode playback.

Physical device display/profile import and real Windows/macOS audio must still be checked on those systems. The profile uses Stream Deck's V1 archive layout; existing v0.1 profiles remain compatible with v0.2 actions.

SDK documentation:
- https://docs.elgato.com/streamdeck/sdk/v2/
- https://docs.elgato.com/streamdeck/sdk/v2/guides/system/


## GitHub releases

Repository name: `giro-soundboard-streamdeck-plugin`.

The workflow in `.github/workflows/build-release.yml` builds, tests, and validates changes on `main` and pull requests. Pushing a tag that matches the package version (for example `v0.6.5`) also publishes a GitHub release with the installer, Stream Deck bundle, and SHA-256 checksums. The workflow uses GitHub's built-in repository token; no personal token needs to be stored in the repository.

Before tagging a new release, update both `package.json` / `package-lock.json` and the plugin manifest (`0.6.5` corresponds to manifest version `0.6.5.0`). Update the installation filename in this README, then build and test.

    git tag v0.6.5
    git push origin main
    git push origin v0.6.5

Generated installers and profiles belong in release downloads. `node_modules`, generated player bundles, runtime logs, and `dist` are excluded from Git. This repository contains the Stream Deck client; the soundboard server and Discord OAuth application run separately.
