import { describe, expect, it } from 'vitest';
import { sumUnread, titleWithoutUnread, unreadFromTitle, unreadLabel } from '../src/apps/unread';

describe('unreadFromTitle', () => {
  it('reads counts from the title prefix', () => {
    expect(unreadFromTitle('(3) Discord | #general')).toEqual({ count: 3, more: false });
    expect(unreadFromTitle('(12) Home / X')).toEqual({ count: 12, more: false });
    expect(unreadFromTitle('(99+) Reddit - Dive into anything')).toEqual({ count: 99, more: true });
  });

  it("reads Discord's unread dot", () => {
    expect(unreadFromTitle('• Discord | #general | Server')).toBe('dot');
    expect(unreadFromTitle('● Discord')).toBe('dot');
  });

  it('ignores titles without an unread prefix', () => {
    expect(unreadFromTitle('Discord | Friends')).toBeNull();
    expect(unreadFromTitle('(0) Discord')).toBeNull();
    expect(unreadFromTitle('Song (2) - YouTube')).toBeNull();
    expect(unreadFromTitle('(abc) Discord')).toBeNull();
    expect(unreadFromTitle('')).toBeNull();
  });
});

describe('sumUnread and unreadLabel', () => {
  it('adds counts, keeps a dot only when there are no counts', () => {
    expect(sumUnread([{ count: 2, more: false }, 'dot', { count: 3, more: false }, null])).toEqual({ count: 5, more: false });
    expect(sumUnread(['dot', null])).toBe('dot');
    expect(sumUnread([null])).toBeNull();
    expect(sumUnread([])).toBeNull();
  });

  it('labels counts, caps at 99+', () => {
    expect(unreadLabel({ count: 7, more: false })).toBe('7');
    expect(unreadLabel({ count: 99, more: true })).toBe('99+');
    expect(unreadLabel({ count: 250, more: false })).toBe('99+');
    expect(unreadLabel('dot')).toBe('');
    expect(unreadLabel(null)).toBe('');
  });
});

describe('titleWithoutUnread', () => {
  it('drops the unread prefix only', () => {
    expect(titleWithoutUnread('(3) Discord | #general')).toBe('Discord | #general');
    expect(titleWithoutUnread('• Discord')).toBe('Discord');
    expect(titleWithoutUnread('Song (2) - YouTube')).toBe('Song (2) - YouTube');
  });
});
