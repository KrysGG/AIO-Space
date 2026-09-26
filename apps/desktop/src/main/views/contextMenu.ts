import type { ContextMenuParams, MenuItemConstructorOptions } from 'electron';
import { isWebUrl } from '@aio/core';

/** Everything the menu can do. ViewManager wires these to the view; tests pass fakes. */
export interface ContextMenuActions {
  canGoBack: boolean;
  canGoForward: boolean;
  back(): void;
  forward(): void;
  reload(): void;
  copyText(text: string): void;
  /** Only ever called with http(s) URLs. */
  openInNewTile(url: string): void;
  /** Only ever called with http(s) URLs. */
  openExternal(url: string): void;
  copyImageAt(x: number, y: number): void;
  replaceMisspelling(word: string): void;
  addToDictionary(word: string): void;
  /** Search URL for selected text with the user's engine, and that engine's name. */
  search: { name: string; url(query: string): string };
  /** Dev builds only; undefined hides "Inspect". */
  inspect?: (x: number, y: number) => void;
}

type Params = Pick<
  ContextMenuParams,
  | 'x'
  | 'y'
  | 'linkURL'
  | 'srcURL'
  | 'mediaType'
  | 'hasImageContents'
  | 'isEditable'
  | 'selectionText'
  | 'misspelledWord'
  | 'dictionarySuggestions'
  | 'editFlags'
>;

const SEPARATOR: MenuItemConstructorOptions = { type: 'separator' };
const MAX_QUOTE = 24;

/**
 * Right-click menu for a web view (ROADMAP 2.4). Sections appear for what was clicked: a link, an
 * image, selected text, or a text field; the page section (back/forward/reload) only when nothing
 * more specific was clicked, as in Chrome.
 */
export function contextMenuTemplate(p: Params, a: ContextMenuActions): MenuItemConstructorOptions[] {
  const sections: MenuItemConstructorOptions[][] = [];
  const link = isWebUrl(p.linkURL) ? p.linkURL : null;
  const image = p.mediaType === 'image' && p.hasImageContents ? p.srcURL : null;
  const selection = p.selectionText.trim();

  if (p.isEditable && p.misspelledWord) {
    const suggestions = p.dictionarySuggestions.slice(0, 5);
    sections.push([
      ...(suggestions.length
        ? suggestions.map((word) => ({ label: word, click: () => a.replaceMisspelling(word) }))
        : [{ label: 'No spelling suggestions', enabled: false }]),
      { label: 'Add to dictionary', click: () => a.addToDictionary(p.misspelledWord) },
    ]);
  }

  if (link) {
    sections.push([
      { label: 'Open link in new Browser tile', click: () => a.openInNewTile(link) },
      { label: 'Open link in system browser', click: () => a.openExternal(link) },
      { label: 'Copy link address', click: () => a.copyText(link) },
    ]);
  }

  if (image) {
    sections.push([
      { label: 'Copy image', click: () => a.copyImageAt(p.x, p.y) },
      ...(isWebUrl(image)
        ? [
            { label: 'Copy image address', click: () => a.copyText(image) },
            { label: 'Open image in new Browser tile', click: () => a.openInNewTile(image) },
          ]
        : []),
    ]);
  }

  if (p.isEditable) {
    const f = p.editFlags;
    sections.push([
      { label: 'Undo', role: 'undo', enabled: f.canUndo },
      { label: 'Redo', role: 'redo', enabled: f.canRedo },
      SEPARATOR,
      { label: 'Cut', role: 'cut', enabled: f.canCut },
      { label: 'Copy', role: 'copy', enabled: f.canCopy },
      { label: 'Paste', role: 'paste', enabled: f.canPaste },
      { label: 'Select all', role: 'selectAll', enabled: f.canSelectAll },
    ]);
  } else if (selection) {
    const quote = selection.length > MAX_QUOTE ? `${selection.slice(0, MAX_QUOTE).trimEnd()}…` : selection;
    sections.push([
      { label: 'Copy', role: 'copy' },
      { label: `Search ${a.search.name} for “${quote}”`, click: () => a.openInNewTile(a.search.url(selection)) },
    ]);
  }

  if (!link && !image && !selection && !p.isEditable) {
    sections.push([
      { label: 'Back', enabled: a.canGoBack, click: a.back },
      { label: 'Forward', enabled: a.canGoForward, click: a.forward },
      { label: 'Reload', click: a.reload },
    ]);
  }

  const inspect = a.inspect;
  if (inspect) sections.push([{ label: 'Inspect', click: () => inspect(p.x, p.y) }]);

  return sections.flatMap((s, i) => (i === 0 ? s : [SEPARATOR, ...s]));
}
