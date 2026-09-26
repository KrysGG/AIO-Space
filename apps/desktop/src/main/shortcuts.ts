import type { Input, WebContents } from 'electron';
import type { FocusDirection } from '@aio/core';
import type { ShortcutAction } from '../shared/ipc';

const ARROWS: Record<string, FocusDirection> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
};

type KeyInput = Pick<Input, 'type' | 'key' | 'code' | 'control' | 'alt' | 'shift' | 'meta' | 'isAutoRepeat'>;

/**
 * App-wide shortcuts. Letters match by `key` (follows the keyboard layout), digits and arrows by
 * `code` (Ctrl+1 on AZERTY reports key "&"). Auto-repeat is ignored so holding Ctrl+W can't close
 * every tile.
 */
export function shortcutFor(input: KeyInput): ShortcutAction | null {
  if (input.type !== 'keyDown' || input.isAutoRepeat || !input.control || input.meta) return null;
  const key = input.key.toLowerCase();
  const { alt, shift } = input;

  if (alt && !shift) {
    const direction = ARROWS[input.code];
    return direction ? { kind: 'focus-direction', direction } : null;
  }
  if (alt) return null;
  // Zoom: Ctrl +/= (Shift allowed, "+" needs it on US layouts), Ctrl -, Ctrl 0, and the numpad keys.
  if (input.code === 'Equal' || input.code === 'NumpadAdd') return { kind: 'zoom', change: 'in' };
  if (input.code === 'Minus' || input.code === 'NumpadSubtract') return { kind: 'zoom', change: 'out' };
  if (!shift && (input.code === 'Digit0' || input.code === 'Numpad0')) return { kind: 'zoom', change: 'reset' };
  if (shift) {
    if (key === 'd') return { kind: 'split', direction: 'row' };
    if (key === 'e') return { kind: 'split', direction: 'column' };
    return null;
  }
  if (key === 'w') return { kind: 'close' };
  if (key === 'r') return { kind: 'reload' };
  if (key === 'l') return { kind: 'focus-address' };
  if (key === '/' || input.code === 'Slash') return { kind: 'help' };
  const digit = /^Digit([1-9])$/.exec(input.code);
  if (digit) return { kind: 'focus-index', index: Number(digit[1]) - 1 };
  return null;
}

/**
 * Catch shortcuts before the page (and Electron's default menu, which also binds Ctrl+W/Ctrl+R)
 * sees them, so they work whichever web view has keyboard focus.
 */
export function forwardShortcuts(wc: WebContents, send: (action: ShortcutAction) => void): void {
  wc.on('before-input-event', (event, input) => {
    const action = shortcutFor(input);
    if (!action) return;
    event.preventDefault();
    send(action);
  });
}
