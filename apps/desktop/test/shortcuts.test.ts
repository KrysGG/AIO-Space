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
  it('maps browser tab keys: Ctrl+T, Ctrl+(Shift+)Tab, Ctrl+PageDown/PageUp (D-049)', () => {
    expect(press({ control: true, key: 't', code: 'KeyT' })).toEqual({ kind: 'new-tab' });
    expect(press({ control: true, key: 'Tab', code: 'Tab' })).toEqual({ kind: 'switch-tab', delta: 1 });
    expect(press({ control: true, shift: true, key: 'Tab', code: 'Tab' })).toEqual({ kind: 'switch-tab', delta: -1 });
    expect(press({ control: true, key: 'PageDown', code: 'PageDown' })).toEqual({ kind: 'switch-tab', delta: 1 });
    expect(press({ control: true, key: 'PageUp', code: 'PageUp' })).toEqual({ kind: 'switch-tab', delta: -1 });
    expect(press({ key: 'Tab', code: 'Tab' })).toBeNull(); // plain Tab stays with the page
    expect(press({ control: true, alt: true, key: 'Tab', code: 'Tab' })).toBeNull();
  });

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
    expect(press({ control: true, shift: true, key: 'B', code: 'KeyB' })).toEqual({ kind: 'toggle-rail' });
    expect(press({ control: true, key: 'b', code: 'KeyB' })).toBeNull(); // Ctrl+B stays bold in editors
  });

  it('maps Ctrl+1..9 by physical key, so AZERTY works', () => {
    expect(press({ control: true, key: '1', code: 'Digit1' })).toEqual({ kind: 'focus-index', index: 0 });
    expect(press({ control: true, key: '&', code: 'Digit1' })).toEqual({ kind: 'focus-index', index: 0 });
    expect(press({ control: true, key: '9', code: 'Digit9' })).toEqual({ kind: 'focus-index', index: 8 });
    expect(press({ control: true, key: '0', code: 'Digit0' })).toEqual({ kind: 'zoom', change: 'reset' }); // Ctrl+0 is zoom reset
  });

  it('leaves everything else to the page', () => {
    expect(press({ key: 'w', code: 'KeyW' })).toBeNull(); // no Ctrl
    expect(press({ control: true, key: 'c', code: 'KeyC' })).toBeNull(); // copy
    expect(press({ control: true, shift: true, key: 'I', code: 'KeyI' })).toBeNull(); // devtools
    expect(press({ control: true, shift: true, key: 'R', code: 'KeyR' })).toBeNull(); // hard reload stays with the page
    expect(press({ control: true, alt: true, key: 'w', code: 'KeyW' })).toBeNull();
    expect(press({ control: true, meta: true, key: 'w', code: 'KeyW' })).toBeNull();
  });

  it('maps zoom keys, including numpad and Ctrl+Shift+= ("+")', () => {
    expect(press({ control: true, key: '=', code: 'Equal' })).toEqual({ kind: 'zoom', change: 'in' });
    expect(press({ control: true, shift: true, key: '+', code: 'Equal' })).toEqual({ kind: 'zoom', change: 'in' });
    expect(press({ control: true, key: '+', code: 'NumpadAdd' })).toEqual({ kind: 'zoom', change: 'in' });
    expect(press({ control: true, key: '-', code: 'Minus' })).toEqual({ kind: 'zoom', change: 'out' });
    expect(press({ control: true, key: '-', code: 'NumpadSubtract' })).toEqual({ kind: 'zoom', change: 'out' });
    expect(press({ control: true, key: '0', code: 'Numpad0' })).toEqual({ kind: 'zoom', change: 'reset' });
    expect(press({ key: '=', code: 'Equal' })).toBeNull(); // no Ctrl
  });

  it('ignores key-up and auto-repeat', () => {
    expect(press({ type: 'keyUp', control: true, key: 'w', code: 'KeyW' })).toBeNull();
    expect(press({ control: true, key: 'w', code: 'KeyW', isAutoRepeat: true })).toBeNull();
  });
});
