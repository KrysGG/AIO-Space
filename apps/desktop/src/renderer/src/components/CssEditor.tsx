import { useEffect, useRef } from 'react';
import { MAX_APP_CSS, type AppCss, type WebAppDef } from '@aio/core';

interface Props {
  app: WebAppDef;
  value: AppCss | undefined;
  onChange(value: AppCss): void;
  onClose(): void;
}

/**
 * Per-app CSS editor (ROADMAP 4.3). Docked beside the tiles instead of over them, so the app's page
 * stays visible and every edit shows in it right away (native views would cover a popover).
 */
export function CssEditor({ app, value, onChange, onClose }: Props) {
  const text = useRef<HTMLTextAreaElement>(null);
  const css = value?.css ?? '';
  const enabled = value?.enabled ?? true;

  useEffect(() => {
    window.aio.focusView(null);
    text.current?.focus();
  }, [app.id]);

  return (
    <aside
      className="css-panel"
      aria-label={`Custom CSS for ${app.name}`}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
    >
      <header className="css-panel-head">
        <h2 className="popover-title">Custom CSS: {app.name}</h2>
        <button className="icon-btn" title="Close" aria-label="Close custom CSS" onClick={onClose}>
          <svg viewBox="0 0 20 20" aria-hidden>
            <path d="m5 5 10 10M15 5 5 15" />
          </svg>
        </button>
      </header>
      <p className="popover-hint">
        Added to every page {app.name} loads; changes show as you type. Add <code>!important</code>{' '}
        to override the site’s own styles, e.g. <code>{'aside { display: none !important; }'}</code>
      </p>
      <textarea
        ref={text}
        className="css-text"
        spellCheck={false}
        maxLength={MAX_APP_CSS}
        placeholder={'/* e.g. hide a sidebar */\n#sidebar { display: none !important; }'}
        value={css}
        onChange={(e) => onChange({ css: e.target.value, enabled })}
      />
      <label className="shield-switch">
        <span>
          Apply this CSS
          <small>Off keeps it here without applying it.</small>
        </span>
        <input
          type="checkbox"
          checked={enabled}
          disabled={!css.trim()}
          onChange={(e) => onChange({ css, enabled: e.target.checked })}
        />
      </label>
    </aside>
  );
}
