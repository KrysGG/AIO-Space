// electron-builder afterPack hook (ROADMAP 3.7/5.3): flip Electron fuses on the packaged binary.
// The table and reasons are in docs/SECURITY.md ("Packaging hardening"); keep them in sync.
const { join } = require('node:path');
const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');

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
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableCookieEncryption]: true,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
    // Checked on macOS and Windows (electron-builder embeds the hashes); Linux ignores it for now.
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
    // The UI is served from aio://app, never file:// (src/main/security/uiProtocol.ts).
    [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
  });
  console.log(`  • fuses flipped on ${binary}`);
};
