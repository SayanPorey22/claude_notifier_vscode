import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

/**
 * Directory where the hook script drops event files and the extension watches.
 * MUST stay in sync with EVENT_DIR in scripts/claude-notify-hook.js.
 */
export const EVENT_DIR = path.join(os.homedir(), '.claude', 'notifier-events');

/** Logical event keys produced by the hook script. */
export type EventKey = 'permission' | 'idle' | 'stop' | 'generic';

/** Shape of an event file written by the hook script. */
export interface NotifierEvent {
  key: EventKey;
  message: string;
  notificationType: string;
  hookEventName: string;
  cwd: string;
  sessionId: string;
  ts: number;
}

const CONFIG_SECTION = 'claudeCodeNotifier';

export function getConfig(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration(CONFIG_SECTION);
}

/** Resolve the configured sound for an event key to an absolute file path. */
export function resolveSoundPath(
  extensionPath: string,
  key: EventKey
): string {
  const cfg = getConfig();
  const map: Record<EventKey, string> = {
    permission: cfg.get<string>('sounds.permission', 'permission.wav'),
    idle: cfg.get<string>('sounds.idle', 'idle.wav'),
    stop: cfg.get<string>('sounds.stop', 'stop.wav'),
    generic: cfg.get<string>('sounds.generic', 'notification.wav'),
  };
  const configured = map[key] || map.generic;
  if (path.isAbsolute(configured)) {
    return configured;
  }
  return path.join(extensionPath, 'sounds', configured);
}

/**
 * Path to the bundled hook bridge script. Quoted/escaped by the caller as
 * needed when building a shell command.
 */
export function hookScriptPath(extensionPath: string): string {
  return path.join(extensionPath, 'scripts', 'claude-notify-hook.js');
}
