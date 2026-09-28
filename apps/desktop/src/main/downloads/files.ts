import { basename, extname, join } from 'node:path';

/**
 * File types the desktop might run instead of open (xdg-open on a .desktop file launches it; Windows
 * runs shortcuts, scripts, installers and mounts disk images). Downloads of these offer "Show in folder"
 * only, never "Open" (ROADMAP 2.6, D-021; Windows additions 6.1).
 */
const RISKY = new Set([
  // Linux, macOS, cross-platform
  '.desktop', '.sh', '.bash', '.zsh', '.fish', '.csh', '.run', '.bin', '.appimage', '.flatpakref',
  '.flatpak', '.snap', '.deb', '.rpm', '.pkg', '.js', '.jar', '.py', '.pl', '.rb', '.php', '.elf', '.so',
  '.command', '.app',
  // Windows: programs, installers, scripts, shortcuts, settings and auto-mounting images
  '.exe', '.msi', '.msp', '.bat', '.cmd', '.com', '.scr', '.pif', '.cpl', '.dll', '.sys', '.drv', '.ocx',
  '.ps1', '.psm1', '.psd1', '.ps1xml', '.vbs', '.vbe', '.jse', '.wsf', '.wsh', '.hta', '.msc', '.reg', '.inf',
  '.lnk', '.url', '.scf', '.appref-ms', '.application', '.settingcontent-ms', '.library-ms', '.search-ms',
  '.msix', '.msixbundle', '.appx', '.appxbundle', '.appinstaller', '.gadget', '.xll', '.iso', '.img',
  '.vhd', '.vhdx',
]);

export function isRiskyToOpen(filename: string): boolean {
  return RISKY.has(extname(filename).toLowerCase());
}

/** Names Windows reserves for devices, with or without an extension ("CON", "nul.txt"). */
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$/i;

/**
 * A name that's safe to write into the downloads folder on any platform: no directories, no hidden
 * files, nothing empty, and valid on Windows (no <>:"|?* characters, no reserved device names, no
 * trailing dots or spaces, which Windows drops, so "a.exe." would become "a.exe"). Chromium already
 * suggests a sanitized name; this is a second line of defence.
 */
export function safeFilename(suggested: string): string {
  const printable = [...suggested].filter((c) => c.charCodeAt(0) >= 0x20 && c.charCodeAt(0) !== 0x7f).join('');
  let name = basename(printable.replace(/\\/g, '/'))
    .replace(/[<>:"|?*]/g, '_')
    .replace(/^\.+/, '')
    .replace(/[. ]+$/, '')
    .trim();
  if (WINDOWS_RESERVED.test(name)) name = `_${name}`;
  if (name.length > 200) {
    const ext = extname(name).slice(0, 20); // keep the extension: it's what the risk check reads
    name = name.slice(0, 200 - ext.length) + ext;
  }
  return name || 'download';
}

/** `dir/name`, or `dir/name (1).ext`, `(2)`... so an existing file is never overwritten. */
export function uniquePath(dir: string, filename: string, exists: (path: string) => boolean): string {
  const ext = extname(filename);
  const stem = ext ? filename.slice(0, -ext.length) : filename;
  let candidate = join(dir, filename);
  for (let i = 1; exists(candidate); i++) candidate = join(dir, `${stem} (${i})${ext}`);
  return candidate;
}
