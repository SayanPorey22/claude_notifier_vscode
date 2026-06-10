import { spawn } from 'child_process';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { getConfig } from './config';

/**
 * Plays audio files using a native OS player. VS Code's extension host has no
 * audio API, so we shell out to the platform's standard tools. On Linux we try
 * a chain of common players (covers desktop + WSL-with-audio setups).
 */
export class SoundPlayer {
  constructor(private readonly log: vscode.OutputChannel) {}

  async play(filePath: string): Promise<void> {
    if (!fs.existsSync(filePath)) {
      this.log.appendLine(`[sound] file not found: ${filePath}`);
      return;
    }

    const custom = getConfig().get<string>('customPlayerCommand', '').trim();
    if (custom) {
      this.runCustom(custom, filePath);
      return;
    }

    const candidates = this.candidatesForPlatform();
    this.tryChain(candidates, filePath);
  }

  private candidatesForPlatform(): Array<{ cmd: string; args: (f: string) => string[] }> {
    switch (process.platform) {
      case 'darwin':
        return [{ cmd: 'afplay', args: (f) => [f] }];
      case 'win32':
        // Use PowerShell's media player; works for wav/mp3 via SoundPlayer/MediaPlayer.
        return [
          {
            cmd: 'powershell',
            args: (f) => [
              '-NoProfile',
              '-Command',
              `(New-Object Media.SoundPlayer '${f.replace(/'/g, "''")}').PlaySync();`,
            ],
          },
        ];
      default:
        // Linux / WSL — try players in order of likelihood.
        return [
          { cmd: 'paplay', args: (f) => [f] },
          { cmd: 'aplay', args: (f) => ['-q', f] },
          { cmd: 'ffplay', args: (f) => ['-nodisp', '-autoexit', '-loglevel', 'quiet', f] },
          { cmd: 'play', args: (f) => ['-q', f] },
          { cmd: 'cvlc', args: (f) => ['--play-and-exit', '--intf', 'dummy', f] },
        ];
    }
  }

  private tryChain(
    candidates: Array<{ cmd: string; args: (f: string) => string[] }>,
    filePath: string,
    index = 0
  ): void {
    if (index >= candidates.length) {
      this.log.appendLine(
        '[sound] no working audio player found. Set "claudeCodeNotifier.customPlayerCommand" to override.'
      );
      return;
    }
    const { cmd, args } = candidates[index];
    let settled = false;
    try {
      const child = spawn(cmd, args(filePath), { stdio: 'ignore' });
      child.on('error', () => {
        if (settled) return;
        settled = true;
        // Player not installed / failed to launch — try the next one.
        this.tryChain(candidates, filePath, index + 1);
      });
      child.on('exit', (code) => {
        if (settled) return;
        settled = true;
        if (code !== 0) {
          this.tryChain(candidates, filePath, index + 1);
        }
      });
    } catch {
      this.tryChain(candidates, filePath, index + 1);
    }
  }

  private runCustom(template: string, filePath: string): void {
    const cmdLine = template.includes('{file}')
      ? template.replace(/\{file\}/g, filePath)
      : `${template} ${filePath}`;
    try {
      const child = spawn(cmdLine, {
        shell: true,
        stdio: 'ignore',
      });
      child.on('error', (err) => {
        this.log.appendLine(`[sound] custom player failed: ${err.message}`);
      });
    } catch (err) {
      this.log.appendLine(`[sound] custom player error: ${String(err)}`);
    }
  }
}
