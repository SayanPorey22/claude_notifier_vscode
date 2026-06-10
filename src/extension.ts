import * as path from 'path';
import * as vscode from 'vscode';
import { EventKey, getConfig, NotifierEvent, resolveSoundPath } from './config';
import { EventWatcher } from './eventWatcher';
import { hooksInstalled, installHooks, uninstallHooks } from './hookInstaller';
import { SoundPlayer } from './soundPlayer';

let watcher: EventWatcher | undefined;
let statusItem: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext): void {
  const log = vscode.window.createOutputChannel('Claude Code Notifier');
  context.subscriptions.push(log);

  const player = new SoundPlayer(log);
  const extensionPath = context.extensionPath;

  statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusItem.command = 'claudeCodeNotifier.toggleEnabled';
  context.subscriptions.push(statusItem);
  updateStatus();

  // --- Event handling ------------------------------------------------------
  watcher = new EventWatcher(log, (event) => handleEvent(event, player, extensionPath, log));
  watcher.start();
  context.subscriptions.push({ dispose: () => watcher?.dispose() });

  // --- Commands ------------------------------------------------------------
  context.subscriptions.push(
    vscode.commands.registerCommand('claudeCodeNotifier.installHooks', () => {
      const res = installHooks(extensionPath);
      void (res.ok ? vscode.window.showInformationMessage(res.message) : vscode.window.showErrorMessage(res.message));
      updateStatus();
    }),

    vscode.commands.registerCommand('claudeCodeNotifier.uninstallHooks', () => {
      const res = uninstallHooks();
      void (res.ok ? vscode.window.showInformationMessage(res.message) : vscode.window.showErrorMessage(res.message));
      updateStatus();
    }),

    vscode.commands.registerCommand('claudeCodeNotifier.testSound', async () => {
      const pick = await vscode.window.showQuickPick(
        ['permission', 'idle', 'stop', 'generic'],
        { placeHolder: 'Which sound do you want to test?' }
      );
      if (pick) {
        void player.play(resolveSoundPath(extensionPath, pick as EventKey));
      }
    }),

    vscode.commands.registerCommand('claudeCodeNotifier.toggleEnabled', async () => {
      const cfg = getConfig();
      const next = !cfg.get<boolean>('enabled', true);
      await cfg.update('enabled', next, vscode.ConfigurationTarget.Global);
      updateStatus();
      void vscode.window.showInformationMessage(
        `Claude Code Notifier ${next ? 'enabled' : 'disabled'}.`
      );
    }),

    vscode.commands.registerCommand('claudeCodeNotifier.openSoundsFolder', () => {
      const folder = vscode.Uri.file(path.join(extensionPath, 'sounds'));
      void vscode.commands.executeCommand('revealFileInOS', folder);
    })
  );

  // React to relevant config changes.
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('claudeCodeNotifier')) {
        updateStatus();
      }
    })
  );

  // First-run nudge to install hooks.
  if (!hooksInstalled()) {
    void vscode.window
      .showInformationMessage(
        'Claude Code Notifier: install Claude Code hooks so you get sounds when Claude needs attention?',
        'Install Hooks',
        'Later'
      )
      .then((choice) => {
        if (choice === 'Install Hooks') {
          void vscode.commands.executeCommand('claudeCodeNotifier.installHooks');
        }
      });
  }

  log.appendLine('Claude Code Notifier activated.');
}

function handleEvent(
  event: NotifierEvent,
  player: SoundPlayer,
  extensionPath: string,
  log: vscode.OutputChannel
): void {
  const cfg = getConfig();
  if (!cfg.get<boolean>('enabled', true)) {
    return;
  }

  // Skip the Stop sound unless the user opted in.
  if (event.key === 'stop' && !cfg.get<boolean>('playStopSound', true)) {
    return;
  }

  // Workspace scoping: avoid every open window playing the same sound.
  if (cfg.get<string>('workspaceScope', 'matching') === 'matching') {
    if (!eventBelongsToThisWindow(event)) {
      return;
    }
  }

  log.appendLine(`[event] ${event.key} (${event.notificationType || event.hookEventName}) cwd=${event.cwd}`);

  void player.play(resolveSoundPath(extensionPath, event.key));

  if (cfg.get<boolean>('showToast', true)) {
    const text = event.message || defaultMessage(event.key);
    void vscode.window.showInformationMessage(`Claude Code: ${text}`);
  }
}

/**
 * When multiple windows are open, only the window whose workspace contains the
 * event's cwd should react. If no workspace is open at all, react anyway so a
 * single editor window still works.
 */
function eventBelongsToThisWindow(event: NotifierEvent): boolean {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    return true;
  }
  if (!event.cwd) {
    return true;
  }
  const cwd = path.resolve(event.cwd);
  return folders.some((f) => {
    const root = path.resolve(f.uri.fsPath);
    return cwd === root || cwd.startsWith(root + path.sep);
  });
}

function defaultMessage(key: EventKey): string {
  switch (key) {
    case 'permission':
      return 'Waiting for permission approval.';
    case 'idle':
      return 'Waiting for your input.';
    case 'stop':
      return 'Finished responding.';
    default:
      return 'Needs your attention.';
  }
}

function updateStatus(): void {
  const enabled = getConfig().get<boolean>('enabled', true);
  const installed = hooksInstalled();
  statusItem.text = enabled ? '$(bell) Claude' : '$(bell-slash) Claude';
  statusItem.tooltip = `Claude Code Notifier — ${enabled ? 'enabled' : 'disabled'}\nHooks ${installed ? 'installed' : 'NOT installed'}\nClick to toggle.`;
  statusItem.show();
}

export function deactivate(): void {
  watcher?.dispose();
}
