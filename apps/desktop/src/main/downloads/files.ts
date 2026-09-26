import { basename, extname, join } from 'node:path';

/**
 * File types the desktop might run instead of open (xdg-open on a .desktop file launches it).
 * Downloads of these offer "Show in folder" only, never "Open" (ROADMAP 2.6, D-021).
 */
const RISKY = new Set([
  '.desktop', '.sh', '.bash', '.zsh', '.fish', '.csh', '.run', '.bin', '.appimage', '.flatpakref',
  '.flatpak', '.snap', '.deb', '.rpm', '.pkg', '.exe', '.msi', '.bat', '.cmd', '.com', '.ps1',
  '.vbs', '.js', '.jar', '.py', '.pl', '.rb', '.php', '.elf', '.so', '.command', '.app', '.scr',
]);

export function isRiskyToOpen(filename: string): boolean {
  return RISKY.has(extname(filename).toLowerCase());
}

/**
 * A name that's safe to write into the downloads folder: no directories, no hidden files,
 * nothing empty. Chromium already suggests a sanitized name; this is a second line of defence.
 */
export function safeFilename(suggested: string): string {
  const printable = [...suggested].filter((c) => c.charCodeAt(0) >= 0x20 && c.charCodeAt(0) !== 0x7f).join('');
  const name = basename(printable.replace(/\\/g, '/'))
    .replace(/^\.+/, '')
    .trim();
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
