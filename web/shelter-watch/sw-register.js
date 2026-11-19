/* Registers the offline cache. Safe to fail: the site works without it. */
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
