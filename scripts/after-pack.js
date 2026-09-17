'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

/**
 * electron-builder `afterPack` hook. Does two jobs, in this order, because the
 * signature has to cover the final contents.
 *
 * 1. Prune the other platforms' ONNX binaries.
 *
 *    onnxruntime-node ships prebuilts for every platform at once, about 289MB
 *    in total, and each build only needs its own. Doing this here rather than
 *    with per-platform `files` globs is deliberate: a platform-level `files`
 *    list overrides the top-level one instead of extending it, which silently
 *    dropped the other exclusions in that list.
 *
 * 2. Ad-hoc sign unsigned macOS builds.
 *
 *    Apple silicon refuses to execute any binary without a signature.
 *    Repacking the Electron bundle invalidates the one it shipped with, so an
 *    unsigned build is not merely "unsigned", it will not launch at all, and
 *    it fails silently with no output and no crash report. electron-builder
 *    skips signing entirely when there is no identity, so this fills the gap.
 *    A real Developer ID makes this step stand aside.
 */

const ONNX_PLATFORMS = ['darwin', 'linux', 'win32'];

/** electron-builder's platform name to the directory onnxruntime uses. */
const ONNX_DIR = {
  darwin: 'darwin',
  linux: 'linux',
  win32: 'win32',
};

function resourcesDir(context) {
  if (context.electronPlatformName === 'darwin') {
    const appName = `${context.packager.appInfo.productFilename}.app`;
    return path.join(context.appOutDir, appName, 'Contents', 'Resources');
  }
  return path.join(context.appOutDir, 'resources');
}

function pruneNativeBinaries(context) {
  const keep = ONNX_DIR[context.electronPlatformName];
  const root = path.join(
    resourcesDir(context),
    'app.asar.unpacked',
    'node_modules',
    'onnxruntime-node',
    'bin',
    'napi-v6'
  );
  if (!fs.existsSync(root)) return;

  let freed = 0;
  for (const p of ONNX_PLATFORMS) {
    if (p === keep) continue;
    const dir = path.join(root, p);
    if (!fs.existsSync(dir)) continue;
    freed += dirSize(dir);
    fs.rmSync(dir, { recursive: true, force: true });
  }

  // Within the kept platform, drop the architectures we are not building.
  const archDir = path.join(root, keep);
  const wanted = context.arch === 1 ? 'x64' : context.arch === 3 ? 'arm64' : null;
  if (wanted && fs.existsSync(archDir)) {
    for (const entry of fs.readdirSync(archDir)) {
      if (entry === wanted) continue;
      const dir = path.join(archDir, entry);
      freed += dirSize(dir);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  if (freed > 0) {
    console.log(`  • pruned native    ${Math.round(freed / 1048576)}MB of other-platform binaries`);
  }
}

function dirSize(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    total += entry.isDirectory() ? dirSize(full) : fs.statSync(full).size;
  }
  return total;
}

function adhocSign(context) {
  if (context.electronPlatformName !== 'darwin') return;

  // A real identity means electron-builder already signed it properly.
  const hasRealIdentity =
    Boolean(process.env.CSC_LINK) ||
    Boolean(process.env.CSC_NAME) ||
    process.env.CSC_IDENTITY_AUTO_DISCOVERY === 'true';
  if (hasRealIdentity) return;

  const appName = `${context.packager.appInfo.productFilename}.app`;
  const appPath = path.join(context.appOutDir, appName);
  const entitlements = path.join(__dirname, '..', 'build', 'entitlements.mac.plist');

  console.log(`  • ad-hoc signing   ${appName}`);

  execFileSync(
    'codesign',
    [
      '--force',
      // --deep is discouraged for real distribution signing, but for an
      // ad-hoc pass it is the simplest way to cover the helpers and the
      // unpacked native modules in one go.
      '--deep',
      '--sign',
      '-',
      '--options',
      'runtime',
      '--entitlements',
      entitlements,
      appPath,
    ],
    { stdio: ['ignore', 'ignore', 'inherit'] }
  );
}

module.exports = async function afterPack(context) {
  pruneNativeBinaries(context);
  adhocSign(context);
};
