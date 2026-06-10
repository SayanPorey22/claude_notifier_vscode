import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { getConfig, hookScriptPath } from './config';

/**
 * Installs / removes the Claude Code hooks that drive the notifier by editing
 * the appropriate settings.json. Our hook entries are tagged so we can find and
 * remove only our own, leaving any user hooks intact.
 */

// A marker embedded in the command so we can identify our own hook entries.
const HOOK_MARKER = 'claude-notify-hook.js';

interface HookCommand {
  type: string;
  command: string;
  timeout?: number;
}
interface HookMatcher {
  matcher?: string;
  hooks: HookCommand[];
}
interface ClaudeSettings {
  hooks?: Record<string, HookMatcher[]>;
  [key: string]: unknown;
}

function settingsPath(): string | undefined {
  const scope = getConfig().get<string>('hookScope', 'user');
  if (scope === 'project') {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      return undefined;
    }
    return path.join(folder.uri.fsPath, '.claude', 'settings.json');
  }
  return path.join(os.homedir(), '.claude', 'settings.json');
}

function readSettings(file: string): ClaudeSettings {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    return raw.trim() ? (JSON.parse(raw) as ClaudeSettings) : {};
  } catch {
    return {};
  }
}

function writeSettings(file: string, settings: ClaudeSettings): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(settings, null, 2) + '\n', 'utf8');
}

/** Build the shell command Claude Code will run for a given event key. */
function buildCommand(extensionPath: string, eventKey: string): string {
  const script = hookScriptPath(extensionPath);
  // Quote the path to tolerate spaces. node must be on PATH (it is wherever
  // Claude Code runs JS-based tooling).
  return `node "${script}" ${eventKey}`;
}

/** The hook entries this extension manages, keyed by Claude hook event name. */
function desiredHooks(extensionPath: string): Record<string, HookMatcher[]> {
  const includeStop = getConfig().get<boolean>('playStopSound', true);

  const hooks: Record<string, HookMatcher[]> = {
    Notification: [
      {
        matcher: 'permission_prompt',
        hooks: [{ type: 'command', command: buildCommand(extensionPath, 'permission'), timeout: 10 }],
      },
      {
        matcher: 'idle_prompt',
        hooks: [{ type: 'command', command: buildCommand(extensionPath, 'idle'), timeout: 10 }],
      },
      {
        matcher: 'elicitation_dialog',
        hooks: [{ type: 'command', command: buildCommand(extensionPath, 'permission'), timeout: 10 }],
      },
    ],
  };

  if (includeStop) {
    hooks.Stop = [
      { hooks: [{ type: 'command', command: buildCommand(extensionPath, 'stop'), timeout: 10 }] },
    ];
  }

  return hooks;
}

/** Strip any matcher entries that contain our marker from an event's array. */
function stripOurs(matchers: HookMatcher[] | undefined): HookMatcher[] {
  if (!matchers) {
    return [];
  }
  return matchers
    .map((m) => ({
      ...m,
      hooks: (m.hooks || []).filter((h) => !h.command?.includes(HOOK_MARKER)),
    }))
    .filter((m) => m.hooks.length > 0);
}

export function installHooks(extensionPath: string): { ok: boolean; message: string } {
  const file = settingsPath();
  if (!file) {
    return { ok: false, message: 'No workspace folder open for project-scoped hooks. Open a folder or set hookScope to "user".' };
  }

  const settings = readSettings(file);
  settings.hooks = settings.hooks || {};

  const desired = desiredHooks(extensionPath);
  for (const [event, matchers] of Object.entries(desired)) {
    // Remove our previous entries, then append the fresh ones.
    const cleaned = stripOurs(settings.hooks[event]);
    settings.hooks[event] = [...cleaned, ...matchers];
  }

  // If Stop is no longer desired, ensure we remove stale Stop entries of ours.
  if (!desired.Stop && settings.hooks.Stop) {
    const cleaned = stripOurs(settings.hooks.Stop);
    if (cleaned.length > 0) {
      settings.hooks.Stop = cleaned;
    } else {
      delete settings.hooks.Stop;
    }
  }

  writeSettings(file, settings);
  return { ok: true, message: `Hooks installed in ${file}. Restart any running Claude Code sessions to pick them up.` };
}

export function uninstallHooks(): { ok: boolean; message: string } {
  const file = settingsPath();
  if (!file || !fs.existsSync(file)) {
    return { ok: true, message: 'No settings file found — nothing to remove.' };
  }

  const settings = readSettings(file);
  if (!settings.hooks) {
    return { ok: true, message: 'No hooks present — nothing to remove.' };
  }

  for (const event of Object.keys(settings.hooks)) {
    const cleaned = stripOurs(settings.hooks[event]);
    if (cleaned.length > 0) {
      settings.hooks[event] = cleaned;
    } else {
      delete settings.hooks[event];
    }
  }
  if (Object.keys(settings.hooks).length === 0) {
    delete settings.hooks;
  }

  writeSettings(file, settings);
  return { ok: true, message: `Notifier hooks removed from ${file}.` };
}

/** True if any of our hooks are present in the active settings file. */
export function hooksInstalled(): boolean {
  const file = settingsPath();
  if (!file || !fs.existsSync(file)) {
    return false;
  }
  const settings = readSettings(file);
  const events = settings.hooks ? Object.values(settings.hooks) : [];
  return events.some((matchers) =>
    (matchers || []).some((m) => (m.hooks || []).some((h) => h.command?.includes(HOOK_MARKER)))
  );
}
