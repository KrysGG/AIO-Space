// electron-builder afterPack hook (ROADMAP 3.7/5.3): flip Electron fuses on the packaged binary.
// The table is in fuses.cjs; the reasons in docs/SECURITY.md ("Packaging hardening").
const { join } = require('node:path');
const { flipFuses, FuseVersion } = require('@electron/fuses');
const { EXPECTED_FUSES } = require('./fuses.cjs');

/** @param {import('electron-builder').AfterPackContext} context */
exports.default = async function afterPack(context) {
  const { electronPlatformName, appOutDir, packager } = context;
  const name = packager.appInfo.productFilename;
  const binary =
    electronPlatformName === 'darwin'
      ? join(appOutDir, `${name}.app`)
      : join(appOutDir, electronPlatformName === 'win32' ? `${name}.exe` : packager.executableName);

  await flipFuses(binary, {
    version: FuseVersion.V1,
    // Linux has no signed-binary check to keep in step with, so no ad-hoc re-signing is needed.
    resetAdHocDarwinSignature: electronPlatformName === 'darwin',
    ...EXPECTED_FUSES,
  });
  console.log(`  • fuses flipped on ${binary}`);
};
