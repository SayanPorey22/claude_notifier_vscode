# Claude Code Notifier

A VS Code extension that **plays a sound whenever Claude Code needs your
attention** — permission requests, idle prompts, and (optionally) when a task
finishes. Walk away from the keyboard and still know the moment Claude is
waiting on you.

## How it works

Claude Code can't push events into VS Code directly, but it has a first-class
**hooks** system. This extension bridges the two:

```
Claude Code ──fires Notification/Stop hook──▶ claude-notify-hook.js
                                                     │ writes a JSON event file
                                                     ▼
                                        ~/.claude/notifier-events/*.json
                                                     │ FileSystemWatcher
                                                     ▼
                        VS Code extension ──▶ plays the mapped sound (+ optional toast)
```

* The hook script is dependency-free and **never blocks Claude Code** (always exits 0).
* Communication is via a watched directory, so it works even if VS Code is
  closed when the hook fires (the event is drained on next start, if recent).

### Events → sounds

| Claude hook | Matcher | Event key | Default sound |
|-------------|---------|-----------|----------------|
| `Notification` | `permission_prompt` | `permission` | `permission.wav` |
| `Notification` | `idle_prompt` | `idle` | `idle.wav` |
| `Notification` | `elicitation_dialog` | `permission` | `permission.wav` |
| `Stop` | — | `stop` | `stop.wav` |
| any other | — | `generic` | `notification.wav` |

## Setup

1. Build/install the extension (see **Development** below), or install the
   packaged `.vsix`.
2. Run **`Claude Code Notifier: Install Claude Code Hooks`** from the Command
   Palette — or accept the first-run prompt. This adds the notifier's hooks to
   your Claude Code `settings.json` (user-level by default).
3. **Restart any running Claude Code sessions** so they reload the hooks.
4. Test with **`Claude Code Notifier: Play a Test Sound`**.

## Commands

| Command | Description |
|---------|-------------|
| `Claude Code Notifier: Install Claude Code Hooks` | Add notifier hooks to settings.json |
| `Claude Code Notifier: Remove Claude Code Hooks` | Remove only the notifier's hooks |
| `Claude Code Notifier: Play a Test Sound` | Preview any of the sounds |
| `Claude Code Notifier: Toggle Notifications On/Off` | Mute/unmute (also via status bar bell) |
| `Claude Code Notifier: Open Sounds Folder` | Reveal the bundled sounds for replacement |

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `claudeCodeNotifier.enabled` | `true` | Master on/off switch. |
| `claudeCodeNotifier.showToast` | `true` | Show a VS Code toast alongside the sound. |
| `claudeCodeNotifier.workspaceScope` | `matching` | `matching`: only the window whose workspace owns the event's `cwd` plays (no duplicates across windows). `always`: every window plays. |
| `claudeCodeNotifier.sounds.permission` | `permission.wav` | Sound for permission requests. |
| `claudeCodeNotifier.sounds.idle` | `idle.wav` | Sound for idle prompts. |
| `claudeCodeNotifier.sounds.stop` | `stop.wav` | Sound when Claude finishes. |
| `claudeCodeNotifier.sounds.generic` | `notification.wav` | Fallback sound. |
| `claudeCodeNotifier.playStopSound` | `true` | Play a sound on every Stop (can be frequent — set to `false` to silence task-completion sounds). |
| `claudeCodeNotifier.customPlayerCommand` | `""` | Override the audio player, e.g. `ffplay -nodisp -autoexit {file}`. |
| `claudeCodeNotifier.hookScope` | `user` | Install hooks in `~/.claude/settings.json` (`user`) or the workspace's `.claude/settings.json` (`project`). |

A sound value that is a bare filename resolves to the bundled `sounds/` folder;
an absolute path is used as-is. **Replace the bundled `*.wav` files** (or point a
setting at your own files) to use your own sounds.

## Audio playback

VS Code's extension host has no audio API, so the extension shells out to a
native player:

* **macOS** — `afplay`
* **Windows** — PowerShell `Media.SoundPlayer`
* **Linux / WSL** — tries `paplay`, `aplay`, `ffplay`, `play`, `cvlc` in order

On WSL you need a working audio path to the host (WSLg provides PulseAudio on
recent Windows builds). If none of the players work, set
`claudeCodeNotifier.customPlayerCommand`.

## Development

```bash
npm install
npm run compile      # or: npm run watch
```

Press <kbd>F5</kbd> in VS Code to launch an Extension Development Host.

Package a `.vsix`:

```bash
npm install -g @vscode/vsce
npm run package
```

## License

MIT
