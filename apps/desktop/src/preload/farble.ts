/**
 * Fingerprinting protection (ROADMAP 3.4), Brave-style "farbling". Runs in the page's MAIN world
 * through `contextBridge.executeInMainWorld`, so this function is serialized: it must be fully
 * self-contained (no imports, no outer variables) and must not leave anything reachable from the
 * page: no globals, no properties; the seed lives only in these closures.
 *
 * - standard: tiny, seeded noise on canvas reads (toDataURL, toBlob, getImageData), WebGL
 *   readPixels and audio reads (AudioBuffer, AnalyserNode). The seed is random per app session and
 *   per run, mixed with the site: stable within a run (sites keep working), different across runs
 *   and apps (no stable fingerprint to link them). `navigator.webdriver` reads false.
 * - strict: also buckets hardwareConcurrency, deviceMemory and screen size, and removes getBattery.
 * - gpc: `navigator.globalPrivacyControl === true`, matching the Sec-GPC header.
 */
export interface FarbleConfig {
  level: 'off' | 'standard' | 'strict';
  gpc: boolean;
  /** 32-bit seed for this app session, run and site. */
  seed: number;
}

export function farble(config: FarbleConfig): void {
  const { level, gpc, seed } = config;
  if (level === 'off' && !gpc) return;

  // Wrapped functions keep the native look: same name, length and toString output.
  const nativeText = new WeakMap<object, string>();
  const fnToString = Function.prototype.toString;
  const disguise = <T extends object>(wrapper: T, original: object, name: string): T => {
    nativeText.set(wrapper, fnToString.call(original));
    Object.defineProperty(wrapper, 'name', { value: name, configurable: true });
    Object.defineProperty(wrapper, 'length', { value: (original as { length: number }).length, configurable: true });
    return wrapper;
  };
  const toStringWrapper = function toString(this: unknown): string {
    if (typeof this === 'function' || (typeof this === 'object' && this !== null)) {
      const text = nativeText.get(this as object);
      if (text !== undefined) return text;
    }
    return fnToString.call(this);
  };
  disguise(toStringWrapper, fnToString, 'toString');
  Object.defineProperty(Function.prototype, 'toString', { value: toStringWrapper, writable: true, configurable: true });

  type Method = (this: never, ...args: never[]) => unknown;
  const wrapMethod = (proto: object | undefined, name: string, make: (original: Method) => Method): void => {
    if (!proto) return;
    const desc = Object.getOwnPropertyDescriptor(proto, name);
    if (!desc || typeof desc.value !== 'function') return;
    const original = desc.value as Method;
    Object.defineProperty(proto, name, { ...desc, value: disguise(make(original), original, name) });
  };
  const defineGetter = (proto: object | undefined, name: string, get: () => unknown): void => {
    if (!proto) return;
    const desc = Object.getOwnPropertyDescriptor(proto, name);
    const getter = { get [name]() { return get(); } };
    const fn = Object.getOwnPropertyDescriptor(getter, name)!.get!;
    if (desc?.get) disguise(fn, desc.get, `get ${name}`);
    else Object.defineProperty(fn, 'name', { value: `get ${name}` });
    Object.defineProperty(proto, name, { get: fn, set: undefined, enumerable: true, configurable: true });
  };

  if (gpc) defineGetter(Navigator.prototype, 'globalPrivacyControl', () => true);
  if (level === 'off') return;

  defineGetter(Navigator.prototype, 'webdriver', () => false);

  // ---- Deterministic noise ---------------------------------------------------------------------
  /** 32-bit integer hash of (seed, n). */
  const mix = (n: number): number => {
    let h = (seed ^ Math.imul(n, 0x9e3779b1)) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    return (h ^ (h >>> 16)) >>> 0;
  };
  /** Flip the lowest bit of one colour channel in about 1 of 32 pixels (invisible, but changes hashes). */
  const farblePixels = (data: Uint8Array | Uint8ClampedArray): void => {
    for (let p = 0, i = 0; i + 3 < data.length; p++, i += 4) {
      const h = mix(p);
      if ((h & 31) !== 0) continue;
      const c = i + ((h >>> 5) % 3);
      data[c] = data[c]! ^ 1;
    }
  };
  /** Scale samples by 1 ± ~1e-7: far below hearing, but changes audio fingerprints. */
  const farbleSamples = (data: Float32Array): void => {
    for (let i = 0; i < data.length; i++) data[i] = data[i]! * (1 + ((mix(i) & 0xffff) - 0x8000) * 3e-12);
  };

  // ---- Canvas ------------------------------------------------------------------------------------
  const MAX_PIXELS = 4096 * 4096;
  const getImageData = CanvasRenderingContext2D.prototype.getImageData;
  wrapMethod(CanvasRenderingContext2D.prototype, 'getImageData', (original) =>
    function (this: CanvasRenderingContext2D, ...args: unknown[]) {
      const image = (original as unknown as (...a: unknown[]) => ImageData).apply(this, args);
      farblePixels(image.data);
      return image;
    } as Method,
  );
  /** A farbled copy of a canvas, for export. Null when it can't be read (empty or too large). */
  const farbledCopy = (canvas: HTMLCanvasElement): HTMLCanvasElement | null => {
    const { width, height } = canvas;
    if (!width || !height || width * height > MAX_PIXELS) return null;
    const copy = document.createElement('canvas');
    copy.width = width;
    copy.height = height;
    const ctx = copy.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(canvas, 0, 0);
    const image = getImageData.call(ctx, 0, 0, width, height);
    farblePixels(image.data);
    ctx.putImageData(image, 0, 0);
    return copy;
  };
  for (const name of ['toDataURL', 'toBlob'] as const) {
    wrapMethod(HTMLCanvasElement.prototype, name, (original) =>
      function (this: HTMLCanvasElement, ...args: unknown[]) {
        let copy: HTMLCanvasElement | null = null;
        try {
          copy = farbledCopy(this);
        } catch {
          // Tainted canvas or lost context: let the original call report it the normal way.
        }
        return (original as unknown as (...a: unknown[]) => unknown).apply(copy ?? this, args);
      } as Method,
    );
  }

  // ---- WebGL ---------------------------------------------------------------------------------------
  for (const proto of [globalThis.WebGLRenderingContext?.prototype, globalThis.WebGL2RenderingContext?.prototype]) {
    wrapMethod(proto, 'readPixels', (original) =>
      function (this: WebGLRenderingContext, ...args: unknown[]) {
        const result = (original as unknown as (...a: unknown[]) => unknown).apply(this, args);
        const pixels = args[6];
        if (pixels instanceof Uint8Array || pixels instanceof Uint8ClampedArray) farblePixels(pixels);
        return result;
      } as Method,
    );
  }

  // ---- Audio -----------------------------------------------------------------------------------
  const farbledChannels = new WeakSet<Float32Array>();
  wrapMethod(globalThis.AudioBuffer?.prototype, 'getChannelData', (original) =>
    function (this: AudioBuffer, ...args: unknown[]) {
      const data = (original as unknown as (...a: unknown[]) => Float32Array).apply(this, args);
      if (!farbledChannels.has(data)) {
        farbledChannels.add(data);
        farbleSamples(data);
      }
      return data;
    } as Method,
  );
  wrapMethod(globalThis.AudioBuffer?.prototype, 'copyFromChannel', (original) =>
    function (this: AudioBuffer, ...args: unknown[]) {
      const result = (original as unknown as (...a: unknown[]) => unknown).apply(this, args);
      if (args[0] instanceof Float32Array) farbleSamples(args[0]);
      return result;
    } as Method,
  );
  wrapMethod(globalThis.AnalyserNode?.prototype, 'getFloatFrequencyData', (original) =>
    function (this: AnalyserNode, ...args: unknown[]) {
      const result = (original as unknown as (...a: unknown[]) => unknown).apply(this, args);
      if (args[0] instanceof Float32Array) farbleSamples(args[0]);
      return result;
    } as Method,
  );

  if (level !== 'strict') return;

  // ---- Strict: common buckets instead of real hardware values ----------------------------------------
  const cores = navigator.hardwareConcurrency >= 8 ? 8 : 4;
  defineGetter(Navigator.prototype, 'hardwareConcurrency', () => cores);
  if ('deviceMemory' in Navigator.prototype) defineGetter(Navigator.prototype, 'deviceMemory', () => 8);
  const SIZES: Array<[number, number]> = [[1366, 768], [1536, 864], [1920, 1080], [2560, 1440], [3840, 2160]];
  const area = screen.width * screen.height;
  const [w, h] = SIZES.reduce((best, s) =>
    Math.abs(s[0] * s[1] - area) < Math.abs(best[0] * best[1] - area) ? s : best,
  );
  for (const [name, value] of [['width', w], ['height', h], ['availWidth', w], ['availHeight', h]] as const) {
    defineGetter(Screen.prototype, name, () => value);
  }
  defineGetter(Screen.prototype, 'colorDepth', () => 24);
  defineGetter(Screen.prototype, 'pixelDepth', () => 24);
  delete (Navigator.prototype as { getBattery?: unknown }).getBattery;
}
