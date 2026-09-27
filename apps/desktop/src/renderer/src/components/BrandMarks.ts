import {
  siBluesky,
  siClaude,
  siFigma,
  siGithub,
  siGmail,
  siGooglecalendar,
  siGooglegemini,
  siKick,
  siMessenger,
  siNetflix,
  siNotion,
  siPinterest,
  siSoundcloud,
  siSpotify,
  siTelegram,
  siTiktok,
  siTwitch,
  siWhatsapp,
  siYoutubemusic,
} from 'simple-icons';

/**
 * Brand marks for app store entries, by store id (Simple Icons, CC0 paths; logos remain their owners'
 * trademarks). Entries without one (their owners asked Simple Icons to remove them) use a monogram.
 */
export const STORE_MARKS: Record<string, string> = {
  twitch: siTwitch.path,
  spotify: siSpotify.path,
  netflix: siNetflix.path,
  whatsapp: siWhatsapp.path,
  telegram: siTelegram.path,
  messenger: siMessenger.path,
  gmail: siGmail.path,
  'google-calendar': siGooglecalendar.path,
  notion: siNotion.path,
  figma: siFigma.path,
  claude: siClaude.path,
  gemini: siGooglegemini.path,
  tiktok: siTiktok.path,
  pinterest: siPinterest.path,
  bluesky: siBluesky.path,
  kick: siKick.path,
  'youtube-music': siYoutubemusic.path,
  soundcloud: siSoundcloud.path,
  github: siGithub.path,
};

/** Very dark brand colours (black logos) would vanish on the dark UI: use the text colour instead. */
export function visibleOnDark(hex: string | undefined): string {
  if (!hex) return 'currentColor';
  const n = Number.parseInt(hex.slice(1), 16);
  const lum = 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
  return lum < 60 ? 'currentColor' : hex;
}
