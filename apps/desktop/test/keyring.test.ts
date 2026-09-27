import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ safeStorage: {} }));
const { isWeakStorage } = await import('../src/main/security/keyring');

describe('keyring check (ROADMAP 3.8)', () => {
  it('flags the basic fallback and unreachable keyrings', () => {
    expect(isWeakStorage('basic_text', false)).toBe(true);
    expect(isWeakStorage('basic_text', true)).toBe(true);
    expect(isWeakStorage('gnome_libsecret', false)).toBe(true); // picked, but the daemon isn't running
    expect(isWeakStorage('unknown', true)).toBe(true);
  });

  it('accepts a working KWallet or GNOME Keyring', () => {
    for (const backend of ['kwallet', 'kwallet5', 'kwallet6', 'gnome_libsecret']) expect(isWeakStorage(backend, true)).toBe(false);
  });
});
