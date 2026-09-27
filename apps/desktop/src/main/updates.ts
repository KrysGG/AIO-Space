import { app } from 'electron';
import { AppImageUpdater } from 'electron-updater';
import type { UpdateStatus } from '../shared/ipc';

/** First check a little after startup, then every 6 hours. */
const FIRST_CHECK_MS = 15_000;
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

/**
 * Updates for the AppImage (ROADMAP 5.4, D-061), from GitHub Releases: checked while the setting is
 * on, downloaded in the background (checked against the sha512 in latest-linux.yml), installed on
 * quit or with "Restart to update". pacman and AUR installs update through the package manager, so
 * nothing runs there: the AppImage updater is created explicitly (never the pacman one), and only when
 * running as a packaged AppImage.
 */
export class Updates {
  private updater: AppImageUpdater | null = null;
  private status: UpdateStatus = { supported: false, state: 'idle' };

  constructor(
    private readonly enabled: () => boolean,
    private readonly onStatus: (status: UpdateStatus) => void,
  ) {}

  start(): void {
    if (!app.isPackaged || !process.env['APPIMAGE']) return;
    const updater = new AppImageUpdater();
    updater.autoDownload = true;
    updater.autoInstallOnAppQuit = true;
    updater.logger = null; // our own status is enough; its logs include local paths
    // Tests serve releases locally (loopback only, with the updater's log on); everyone else gets
    // GitHub from app-update.yml.
    const feed = process.env['SPACEAIO_UPDATE_FEED'];
    if (feed && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(feed)) {
      updater.setFeedURL({ provider: 'generic', url: feed });
      updater.logger = console;
    }
    updater.on('checking-for-update', () => this.set({ state: 'checking' }));
    updater.on('update-not-available', () => this.set({ state: 'none' }));
    updater.on('update-available', (info) => this.set({ state: 'downloading', version: info.version, percent: 0 }));
    updater.on('download-progress', (p) => this.set({ ...this.status, state: 'downloading', percent: Math.round(p.percent) }));
    updater.on('update-downloaded', (info) => this.set({ state: 'ready', version: info.version }));
    updater.on('error', (err) => this.set({ state: 'error', error: err.message.split('\n')[0]!.slice(0, 200) }));
    this.updater = updater;
    this.set({ state: 'idle' });
    setTimeout(() => this.check(false), FIRST_CHECK_MS).unref();
    setInterval(() => this.check(false), CHECK_EVERY_MS).unref();
  }

  get(): UpdateStatus {
    return this.status;
  }

  /** `manual`: the user pressed "Check now", which works even with automatic checks off. */
  check(manual: boolean): void {
    if (!this.updater || (!manual && !this.enabled())) return;
    if (this.status.state === 'checking' || this.status.state === 'downloading' || this.status.state === 'ready') return;
    void this.updater.checkForUpdates().catch(() => {}); // failures arrive as 'error' events
  }

  /** Quit, replace the AppImage with the downloaded one, and start it. */
  install(): void {
    if (this.updater && this.status.state === 'ready') this.updater.quitAndInstall();
  }

  private set(status: Omit<UpdateStatus, 'supported'>): void {
    this.status = { ...status, supported: true };
    this.onStatus(this.status);
  }
}
