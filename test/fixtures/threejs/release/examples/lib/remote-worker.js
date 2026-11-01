// Fetches from another origin and reports how that went.
fetch('http://example.invalid/data').then(
  () => postMessage('fetched'),
  () => postMessage('refused'),
);
