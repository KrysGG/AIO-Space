import { unreadLabel, type Unread } from '@aio/core';

/** Count pill ("3", "99+") or a dot for unread-without-count. Renders nothing when read. */
export function UnreadBadge({ unread, className = '' }: { unread: Unread; className?: string }) {
  if (!unread) return null;
  const label = unreadLabel(unread);
  const text = label ? `${label} unread` : 'New activity';
  return (
    <span className={`unread${label ? '' : ' unread-dot'} ${className}`.trim()} title={text} aria-label={text}>
      {label}
    </span>
  );
}
