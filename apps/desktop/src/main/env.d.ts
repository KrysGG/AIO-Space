/** Vite's `?raw` imports: a file's text, bundled into main (used for vendored page scripts). */
declare module '*?raw' {
  const text: string;
  export default text;
}
