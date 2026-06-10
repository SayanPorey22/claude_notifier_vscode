import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { EVENT_DIR, NotifierEvent } from './config';

/**
 * Watches the shared event directory for new event files dropped by the hook
 * script and forwards parsed events to a callback. Consumed files are deleted.
 */
export class EventWatcher {
  private watcher: vscode.FileSystemWatcher | undefined;

  constructor(
    private readonly log: vscode.OutputChannel,
    private readonly onEvent: (event: NotifierEvent) => void
  ) {}

  start(): void {
    fs.mkdirSync(EVENT_DIR, { recursive: true });

    const pattern = new vscode.RelativePattern(EVENT_DIR, '*.json');
    this.watcher = vscode.workspace.createFileSystemWatcher(
      pattern,
      false, // watch creates
      true, // ignore changes
      true // ignore deletes
    );
    this.watcher.onDidCreate((uri) => this.handleFile(uri.fsPath));

    // Drain any events that arrived before we started watching.
    this.drainExisting();

    this.log.appendLine(`[watcher] watching ${EVENT_DIR}`);
  }

  private drainExisting(): void {
    try {
      for (const name of fs.readdirSync(EVENT_DIR)) {
        if (name.endsWith('.json')) {
          this.handleFile(path.join(EVENT_DIR, name));
        }
      }
    } catch {
      /* directory may not exist yet — ignore */
    }
  }

  private handleFile(filePath: string): void {
    // Small retry: the watcher can fire a hair before the rename is visible.
    this.readWithRetry(filePath, 3);
  }

  private readWithRetry(filePath: string, attempts: number): void {
    let raw: string;
    try {
      raw = fs.readFileSync(filePath, 'utf8');
    } catch {
      if (attempts > 0) {
        setTimeout(() => this.readWithRetry(filePath, attempts - 1), 50);
      }
      return;
    }

    // Consume the file regardless of parse success so it can't pile up.
    try {
      fs.unlinkSync(filePath);
    } catch {
      /* ignore */
    }

    let event: NotifierEvent;
    try {
      event = JSON.parse(raw) as NotifierEvent;
    } catch {
      this.log.appendLine(`[watcher] skipped unparseable event: ${filePath}`);
      return;
    }

    // Ignore stale events (e.g. left over from a previous session) older than 30s.
    if (event.ts && Date.now() - event.ts > 30_000) {
      return;
    }

    this.onEvent(event);
  }

  dispose(): void {
    this.watcher?.dispose();
  }
}
