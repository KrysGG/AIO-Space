// AIO Space plugin script: runs in its own isolated world on youtube.com pages (the page's scripts
// can't see it). Opens a Short as a normal video, on page loads and on YouTube's in-page navigation.
(() => {
  const toWatch = () => {
    const m = location.pathname.match(/^\/shorts\/([A-Za-z0-9_-]{6,20})/);
    if (m) location.replace(`/watch?v=${m[1]}`);
  };
  toWatch();
  document.addEventListener('yt-navigate-finish', toWatch);
  window.addEventListener('popstate', toWatch);
})();
