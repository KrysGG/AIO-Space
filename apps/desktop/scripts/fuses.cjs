// The Electron fuses every packaged build must have (ROADMAP 3.7/5.3). Used by afterPack.cjs to set them
// and by verify-release.cjs to check the release files. Reasons: docs/SECURITY.md, "Packaging hardening".
const { FuseV1Options } = require('@electron/fuses');

exports.EXPECTED_FUSES = {
  [FuseV1Options.RunAsNode]: false,
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
  [FuseV1Options.EnableNodeCliInspectArguments]: false,
  [FuseV1Options.EnableCookieEncryption]: true,
  [FuseV1Options.OnlyLoadAppFromAsar]: true,
  // Checked on macOS and Windows (electron-builder embeds the hashes); Linux ignores it for now.
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
  // The UI is served from aio://app, never file:// (src/main/security/uiProtocol.ts).
  [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
};
