import { safeStorage } from 'electron';
import type { StorageStatus } from '../../shared/ipc';

/**
 * How cookies and saved logins are encrypted on disk (ROADMAP 3.8). On Linux Chromium uses the
 * desktop keyring (KWallet or GNOME Keyring via libsecret); without one it falls back to "basic",
 * a fixed key, so anyone who can read the profile folder can read the logins. A keyring that was
 * picked but can't be reached (daemon not running, locked) also leaves encryption unavailable.
 * Call after app ready.
 */
export function storageStatus(): StorageStatus {
  if (process.platform !== 'linux') return { backend: 'os', weak: !safeStorage.isEncryptionAvailable() };
  const available = safeStorage.isEncryptionAvailable();
  const backend = safeStorage.getSelectedStorageBackend();
  return { backend, weak: isWeakStorage(backend, available) };
}

/** Exported for tests. */
export function isWeakStorage(backend: string, encryptionAvailable: boolean): boolean {
  return backend === 'basic_text' || backend === 'unknown' || !encryptionAvailable;
}
