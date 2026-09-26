import { describe, expect, it, vi } from 'vitest';
import type { ContextMenuParams, MenuItemConstructorOptions } from 'electron';
import { contextMenuTemplate, type ContextMenuActions } from '../src/main/views/contextMenu';

const noEdit = { canUndo: false, canRedo: false, canCut: false, canCopy: false, canPaste: false, canDelete: false, canSelectAll: false, canEditRichly: false };
const params = (p: Partial<ContextMenuParams> = {}) =>
  ({
    x: 10,
    y: 20,
    linkURL: '',
    srcURL: '',
    mediaType: 'none',
    hasImageContents: false,
    isEditable: false,
    selectionText: '',
    misspelledWord: '',
    dictionarySuggestions: [],
    editFlags: noEdit,
    ...p,
  }) as ContextMenuParams;

const actions = (a: Partial<ContextMenuActions> = {}): ContextMenuActions => ({
  canGoBack: true,
  canGoForward: false,
  back: vi.fn(),
  forward: vi.fn(),
  reload: vi.fn(),
  copyText: vi.fn(),
  openInNewTile: vi.fn(),
  openExternal: vi.fn(),
  copyImageAt: vi.fn(),
  replaceMisspelling: vi.fn(),
  addToDictionary: vi.fn(),
  search: { name: 'DuckDuckGo', url: (q) => `https://duckduckgo.com/?q=${encodeURIComponent(q)}` },
  ...a,
});

const labels = (items: MenuItemConstructorOptions[]) => items.map((i) => (i.type === 'separator' ? '—' : i.label));
const item = (items: MenuItemConstructorOptions[], label: string) => {
  const found = items.find((i) => i.label === label);
  if (!found) throw new Error(`no "${label}" in ${labels(items).join(', ')}`);
  return found;
};
const click = (i: MenuItemConstructorOptions) => (i.click as () => void)();

describe('contextMenuTemplate', () => {
  it('plain page: back, forward, reload (with history state)', () => {
    const m = contextMenuTemplate(params(), actions());
    expect(labels(m)).toEqual(['Back', 'Forward', 'Reload']);
    expect(item(m, 'Back').enabled).toBe(true);
    expect(item(m, 'Forward').enabled).toBe(false);
  });

  it('link: open in new tile, open in system browser, copy address', () => {
    const a = actions();
    const m = contextMenuTemplate(params({ linkURL: 'https://example.com/x' }), a);
    expect(labels(m)).toEqual(['Open link in new Browser tile', 'Open link in system browser', 'Copy link address']);
    click(item(m, 'Open link in new Browser tile'));
    click(item(m, 'Open link in system browser'));
    click(item(m, 'Copy link address'));
    expect(a.openInNewTile).toHaveBeenCalledWith('https://example.com/x');
    expect(a.openExternal).toHaveBeenCalledWith('https://example.com/x');
    expect(a.copyText).toHaveBeenCalledWith('https://example.com/x');
  });

  it('never offers to open non-web links', () => {
    for (const linkURL of ['javascript:alert(1)', 'file:///etc/passwd', 'mailto:a@b.c']) {
      expect(labels(contextMenuTemplate(params({ linkURL }), actions()))).toEqual(['Back', 'Forward', 'Reload']);
    }
  });

  it('image: copy image, copy address, open in a new tile', () => {
    const a = actions();
    const m = contextMenuTemplate(params({ mediaType: 'image', hasImageContents: true, srcURL: 'https://img.example/a.png' }), a);
    expect(labels(m)).toEqual(['Copy image', 'Copy image address', 'Open image in new Browser tile']);
    click(item(m, 'Copy image'));
    expect(a.copyImageAt).toHaveBeenCalledWith(10, 20);
    // data: images can be copied but not opened
    expect(labels(contextMenuTemplate(params({ mediaType: 'image', hasImageContents: true, srcURL: 'data:image/png;base64,AA' }), actions()))).toEqual(['Copy image']);
  });

  it('linked image: link section, then image section', () => {
    const m = contextMenuTemplate(params({ linkURL: 'https://example.com/', mediaType: 'image', hasImageContents: true, srcURL: 'https://img.example/a.png' }), actions());
    expect(labels(m)).toEqual(['Open link in new Browser tile', 'Open link in system browser', 'Copy link address', '—', 'Copy image', 'Copy image address', 'Open image in new Browser tile']);
  });

  it('selected text: copy and search with the chosen engine in a new tile', () => {
    const a = actions();
    const m = contextMenuTemplate(params({ selectionText: '  a fairly long piece of selected text  ' }), a);
    expect(labels(m)).toEqual(['Copy', 'Search DuckDuckGo for “a fairly long piece of s…”']);
    expect(item(m, 'Copy').role).toBe('copy');
    click(m[1]!);
    expect(a.openInNewTile).toHaveBeenCalledWith('https://duckduckgo.com/?q=a%20fairly%20long%20piece%20of%20selected%20text');
  });

  it('text field: edit commands follow the edit flags', () => {
    const m = contextMenuTemplate(params({ isEditable: true, editFlags: { ...noEdit, canPaste: true, canSelectAll: true } }), actions());
    expect(labels(m)).toEqual(['Undo', 'Redo', '—', 'Cut', 'Copy', 'Paste', 'Select all']);
    expect(item(m, 'Paste').enabled).toBe(true);
    expect(item(m, 'Cut').enabled).toBe(false);
  });

  it('misspelled word: suggestions and add to dictionary come first', () => {
    const a = actions();
    const m = contextMenuTemplate(params({ isEditable: true, misspelledWord: 'teh', dictionarySuggestions: ['the', 'ten', 'tea'] }), a);
    expect(labels(m).slice(0, 5)).toEqual(['the', 'ten', 'tea', 'Add to dictionary', '—']);
    click(item(m, 'the'));
    click(item(m, 'Add to dictionary'));
    expect(a.replaceMisspelling).toHaveBeenCalledWith('the');
    expect(a.addToDictionary).toHaveBeenCalledWith('teh');
    const none = contextMenuTemplate(params({ isEditable: true, misspelledWord: 'zzqx', dictionarySuggestions: [] }), actions());
    expect(item(none, 'No spelling suggestions').enabled).toBe(false);
  });

  it('adds Inspect only when provided (dev builds)', () => {
    const inspect = vi.fn();
    const m = contextMenuTemplate(params(), actions({ inspect }));
    expect(labels(m)).toEqual(['Back', 'Forward', 'Reload', '—', 'Inspect']);
    click(item(m, 'Inspect'));
    expect(inspect).toHaveBeenCalledWith(10, 20);
  });
});
