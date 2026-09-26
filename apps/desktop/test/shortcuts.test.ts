import { describe, expect, it } from 'vitest';
import { shortcutFor } from '../src/main/shortcuts';

type Keys = Partial<Parameters<typeof shortcutFor>[0]>;
const press = (keys: Keys) =>
  shortcutFor({
    type: 'keyDown',
    key: '',
    code: '',
    control: false,
    alt: false,
    shift: false,
    meta: false,
    isAutoRepeat: false,
    ...keys,
  });

describe('shortcutFor', () => {
  it('maps Ctrl+Alt+Arrow to focus movement', () => {
    expect(press({ control: true, alt: true, key: 'ArrowLeft', code: 'ArrowLeft' })).toEqual({ kind: 'focus-direction', direction: 'left' });
    expect(press({ control: true, alt: true, key: 'ArrowDown', code: 'ArrowDown' })).toEqual({ kind: 'focus-direction', direction: 'down' });
  });

  it('maps Ctrl+Shift+D/E to splits, whatever the case of the key', () => {
    expect(press({ control: true, shift: true, key: 'D', code: 'KeyD' })).toEqual({ kind: 'split', direction: 'row' });
    expect(press({ control: true, shift: true, key: 'e', code: 'KeyE' })).toEqual({ kind: 'split', direction: 'column' });
  });

  it('maps Ctrl+W, Ctrl+R, Ctrl+L and Ctrl+/', () => {
    expect(press({ control: true, key: 'l', code: 'KeyL' })).toEqual({ kind: 'focus-address' });
    expect(press({ control: true, key: 'w', code: 'KeyW' })).toEqual({ kind: 'close' });
    expect(press({ control: true, key: 'r', code: 'KeyR' })).toEqual({ kind: 'reload' });
    expect(press({ control: true, key: '/', code: 'Slash' })).toEqual({ kind: 'help' });
  });

  it('maps Ctrl+1..9 by physical key, so AZERTY works', () => {
    expect(press({ control: true, key: '1', code: 'Digit1' })).toEqual({ kind: 'focus-index', index: 0 });
    expect(press({ control: true, key: '&', code: 'Digit1' })).toEqual({ kind: 'focus-index', index: 0 });
    expect(press({ control: true, key: '9', code: 'Digit9' })).toEqual({ kind: 'focus-index', index: 8 });
    expect(press({ control: true, key: '0', code: 'Digit0' })).toBeNull();
  });

  it('leaves everything else to the page', () => {
    expect(press({ key: 'w', code: 'KeyW' })).toBeNull(); // no Ctrl
    expect(press({ control: true, key: 'c', code: 'KeyC' })).toBeNull(); // copy
    expect(press({ control: true, shift: true, key: 'I', code: 'KeyI' })).toBeNull(); // devtools
    expect(press({ control: true, shift: true, key: 'R', code: 'KeyR' })).toBeNull(); // hard reload stays with the page
    expect(press({ control: true, alt: true, key: 'w', code: 'KeyW' })).toBeNull();
    expect(press({ control: true, meta: true, key: 'w', code: 'KeyW' })).toBeNull();
  });

  it('ignores key-up and auto-repeat', () => {
    expect(press({ type: 'keyUp', control: true, key: 'w', code: 'KeyW' })).toBeNull();
    expect(press({ control: true, key: 'w', code: 'KeyW', isAutoRepeat: true })).toBeNull();
  });
});
