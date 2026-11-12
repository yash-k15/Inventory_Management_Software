import { spawn } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import process from 'node:process';

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const markerPath = path.join(projectRoot, 'src-tauri', '.dev-restart-request');
const isWindows = process.platform === 'win32';

let stopping = false;
let activeChild = null;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function stopProcessTree(child) {
  if (!child || child.exitCode !== null) return;

  if (isWindows) {
    await new Promise((resolve) => {
      const killer = spawn(
        'taskkill',
        ['/pid', String(child.pid), '/t', '/f'],
        {
          stdio: 'ignore',
          windowsHide: true,
        },
      );

      killer.once('error', resolve);
      killer.once('close', resolve);
    });
  } else {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      try {
        child.kill('SIGTERM');
      } catch {}
    }
  }
}

async function runTauriDev() {
  while (!stopping) {
    try {
      unlinkSync(markerPath);
    } catch {}

    const child = spawn(
      isWindows ? 'npm.cmd' : 'npm',
      ['run', 'tauri', '--', 'dev'],
      {
        cwd: projectRoot,
        stdio: 'inherit',
        detached: !isWindows,
        windowsHide: false,
      },
    );

    activeChild = child;

    let restartRequested = false;
    let childClosed = false;

    child.once('close', () => {
      childClosed = true;
    });

    while (!childClosed && !stopping) {
      if (existsSync(markerPath)) {
        restartRequested = true;

        try {
          unlinkSync(markerPath);
        } catch {}

        await stopProcessTree(child);
        break;
      }

      await delay(200);
    }

    // IMPORTANT: Check once more after the child closes.
    // The app may exit immediately after Rust writes the marker,
    // before the polling loop gets another chance to detect it.
    if (!restartRequested && existsSync(markerPath)) {
      restartRequested = true;

      try {
        unlinkSync(markerPath);
      } catch {}
    }

    if (stopping) {
      await stopProcessTree(child);
      break;
    }

    if (restartRequested) {
      await new Promise((resolve) => {
        if (childClosed) return resolve();
        child.once('close', resolve);
      });

      activeChild = null;
      await delay(700);

      console.log(
        '\n[dev-supervisor] Import restart requested. Starting Tauri + Vite again...\n',
      );
      continue;
    }

    activeChild = null;
    break;
  }
}

function shutdown() {
  stopping = true;

  if (activeChild) {
    void stopProcessTree(activeChild);
  }
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await runTauriDev();
