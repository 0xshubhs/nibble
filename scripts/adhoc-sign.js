'use strict';
const { execFileSync } = require('child_process');
const path = require('path');

/**
 * electron-builder `afterPack` hook: ad-hoc sign unsigned macOS builds.
 *
 * Apple silicon refuses to execute any binary without a signature. Repacking
 * the Electron bundle invalidates the one it shipped with, so an unsigned
 * build is not merely "unsigned" -- it will not launch at all, and it fails
 * silently, with no output and no crash report.
 *
 * electron-builder skips signing entirely when there is no identity, so this
 * fills the gap with an ad-hoc signature (`-`). That is enough to run locally
 * and to hand someone a build they can open past Gatekeeper's warning. It is
 * NOT enough to notarize -- for that, set a real Developer ID and this hook
 * steps aside.
 */
module.exports = async function adhocSign(context) {
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

  console.log(`  • ad-hoc signing   ${appName} (${context.arch === 1 ? 'x64' : 'arm64'})`);

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
};
