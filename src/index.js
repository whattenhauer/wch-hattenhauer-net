/**
 * wch-hattenhauer-net
 *
 * Serves random images from the private R2 bucket `wch-assets` -> `gallery/` prefix.
 * Images cycle on a 4783-minute (~3 days 7 hours) interval.
 * The viewer never sees the R2 object keys, bucket URL, or any credentials.
 */

// Cycle interval: 4783 minutes = 286,980,000 ms
const CYCLE_MS = 4783 * 60 * 1000;

// ---------------------------------------------------------------------------
// 1.  HTML page  (GET /)
// ---------------------------------------------------------------------------
const HTML = /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>WCH Hattenhauer</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { height: 100%; background: #111; overflow: hidden;
    user-select: none; -webkit-user-select: none; }
  #stage { display: flex; align-items: center; justify-content: center;
    height: 100%; transition: opacity 1.5s ease-in-out; }
  #stage.fade-out { opacity: 0; }
  canvas { max-width: 100vw; max-height: 100vh; object-fit: contain;
    -webkit-user-drag: none; pointer-events: none; }
</style>
</head>
<body oncontextmenu="return false" ondragstart="return false"
      onselectstart="return false">
<div id="stage">
  <canvas id="c"></canvas>
</div>
<script>
(() => {
  const CYCLE_MS = ${CYCLE_MS};  // 4783 minutes
  const stage = document.getElementById('stage');
  const canvas = document.getElementById('c');
  const ctx = canvas.getContext('2d');
  const img = new Image();

  img.onload = () => {
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    ctx.drawImage(img, 0, 0);
    img.src = '';
    stage.classList.remove('fade-out');
  };

  async function showRandom() {
    try {
      stage.classList.add('fade-out');
      await new Promise(r => setTimeout(r, 1500));
      const res = await fetch('/random-img', { cache: 'no-store' });
      if (!res.ok) { stage.classList.remove('fade-out'); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      img.src = url;
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (_) { stage.classList.remove('fade-out'); }
  }

  function scheduleNext() {
    setTimeout(async () => {
      await showRandom();
      scheduleNext();
    }, CYCLE_MS);
  }

  // First image immediately, then cycle every 4783 minutes
  showRandom().then(scheduleNext);
})();
</script>
</body>
</html>`;

// ---------------------------------------------------------------------------
// 2.  Random image endpoint  (GET /random-img)
// ---------------------------------------------------------------------------
async function serveRandomImage(env) {
  const imageExts = /\.(jpe?g|png|gif|webp|bmp|svg|avif)$/i;
  let cursor;
  const keys = [];

  do {
    const listed = await env.ASSETS.list({ cursor, limit: 1000, prefix: 'gallery/' });
    for (const obj of listed.objects) {
      if (imageExts.test(obj.key)) keys.push(obj.key);
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);

  if (keys.length === 0) {
    return new Response('No images found in gallery/ prefix.', {
      status: 404,
      headers: { 'Content-Type': 'text/plain' },
    });
  }

  const key = keys[Math.floor(Math.random() * keys.length)];
  const object = await env.ASSETS.get(key);

  if (object === null) {
    return new Response('Object not found.', { status: 404 });
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('Content-Type', object.httpMetadata?.contentType || 'image/jpeg');
  headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  headers.set('Pragma', 'no-cache');
  headers.set('Expires', '0');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  headers.set('X-Frame-Options', 'DENY');

  return new Response(object.body, { status: 200, headers });
}

// ---------------------------------------------------------------------------
// 3.  Worker entry
// ---------------------------------------------------------------------------
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method !== 'GET') {
      return new Response('Method Not Allowed', {
        status: 405,
        headers: { Allow: 'GET' },
      });
    }

    switch (url.pathname) {
      case '/':
        return new Response(HTML, {
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store',
            'Referrer-Policy': 'no-referrer',
            'X-Frame-Options': 'DENY',
          },
        });

      case '/random-img':
        return serveRandomImage(env);

      default:
        return new Response('Not Found', { status: 404 });
    }
  },
};
