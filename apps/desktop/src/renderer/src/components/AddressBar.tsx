import { useState, type KeyboardEvent } from 'react';
import { SEARCH_ENGINES, type SearchEngineId } from '@aio/core';

interface Props {
  leafId: string;
  /** The page's current URL; shown whenever the user isn't typing. */
  url: string;
  engine: SearchEngineId;
  onEngine(engine: SearchEngineId): void;
  onGo(text: string): void;
}

/**
 * Browser tile header: search engine dropdown and address/search box. Ctrl+L focuses the box.
 * The <select> list opens as its own popup window, so it shows above the web views (D-016).
 */
export function AddressBar({ leafId, url, engine, onEngine, onGo }: Props) {
  // null = not editing: follow the page's URL. A string = what the user is typing.
  const [draft, setDraft] = useState<string | null>(null);

  // Done typing: hand the keyboard back to the page.
  const leave = (input: HTMLInputElement): void => {
    setDraft(null);
    input.blur();
    window.aio.focusView(leafId);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter' && draft?.trim()) {
      onGo(draft);
      leave(e.currentTarget);
    } else if (e.key === 'Escape') {
      leave(e.currentTarget);
    }
  };

  return (
    <div className="address">
      <select
        className="address-engine"
        aria-label="Search engine"
        title="Search engine"
        value={engine}
        onChange={(e) => onEngine(e.target.value as SearchEngineId)}
      >
        {Object.values(SEARCH_ENGINES).map((e) => (
          <option key={e.id} value={e.id}>
            {e.name}
          </option>
        ))}
      </select>
      <input
        className="address-input"
        data-address-for={leafId}
        aria-label="Address or search"
        placeholder={`Search with ${SEARCH_ENGINES[engine].name} or type an address`}
        spellCheck={false}
        value={draft ?? url}
        onFocus={(e) => {
          setDraft(e.currentTarget.value);
          e.currentTarget.select();
        }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => setDraft(null)}
        onKeyDown={onKeyDown}
      />
    </div>
  );
}
