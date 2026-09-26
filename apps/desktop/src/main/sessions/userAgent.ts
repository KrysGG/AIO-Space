/** Remove Electron and app-name tokens from a UA string, leaving a normal Chrome UA. */
export function cleanUserAgent(ua: string, appName: string): string {
  const escaped = appName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return ua
    .replace(/\sElectron\/\S+/gi, '')
    .replace(new RegExp(`\\s${escaped}\\/\\S+`, 'gi'), '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
