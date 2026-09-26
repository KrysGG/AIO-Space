import type { AioApi } from '../../shared/ipc';

declare global {
  interface Window {
    aio: AioApi;
  }
}
export {};
