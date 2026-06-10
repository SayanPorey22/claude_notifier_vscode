#!/usr/bin/env node
/**
 * Claude Code Notifier — hook bridge script.
 *
 * Claude Code invokes this script for Notification / Stop hooks. Claude passes
 * the hook event as JSON on stdin; we additionally receive an "event key"
 * (permission | idle | stop | generic) as the first CLI argument so we don't
 * have to re-derive it from the payload.
 *
 * The script writes a small JSON "event file" into a shared directory that the
 * VS Code extension watches with a FileSystemWatcher. This fully decouples
 * Claude Code from the editor: the hook succeeds whether or not VS Code is open.
 *
 * It is intentionally dependency-free so it can run under whatever Node the
 * user has on PATH.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

// Must match EVENT_DIR in src/config.ts
const EVENT_DIR = path.join(os.homedir(), '.claude', 'notifier-events');

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    // If stdin is a TTY (script run manually) just resolve empty.
    if (process.stdin.isTTY) {
      resolve('');
      return;
    }
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', () => resolve(data));
    // Safety: don't hang forever if no input arrives.
    setTimeout(() => resolve(data), 1500);
  });
}

async function main() {
  const eventKey = (process.argv[2] || 'generic').trim();

  let payload = {};
  try {
    const raw = await readStdin();
    if (raw && raw.trim()) {
      payload = JSON.parse(raw);
    }
  } catch (_e) {
    // Malformed/empty stdin is fine — we still emit an event.
  }

  const event = {
    key: eventKey,
    message: payload.message || '',
    notificationType: payload.notification_type || '',
    hookEventName: payload.hook_event_name || '',
    cwd: payload.cwd || process.cwd(),
    sessionId: payload.session_id || '',
    ts: Date.now(),
  };

  try {
    fs.mkdirSync(EVENT_DIR, { recursive: true });
    const name =
      String(event.ts) +
      '-' +
      Math.floor(Math.random() * 1e6).toString(36) +
      '.json';
    // Write to a temp name then rename so the watcher never sees a partial file.
    const finalPath = path.join(EVENT_DIR, name);
    const tmpPath = finalPath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(event));
    fs.renameSync(tmpPath, finalPath);
  } catch (_e) {
    // Never fail the hook because of a notifier problem.
  }

  // Always exit 0: a notifier must never block Claude Code.
  process.exit(0);
}

main();
