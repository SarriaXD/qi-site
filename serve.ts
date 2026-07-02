// Static server for the portfolio — run by launchd (com.qi.qi-site-server),
// exposed as me.sarria.ca via the qi-site cloudflared tunnel.
const ROOT = import.meta.dir;

const server = Bun.serve({
  hostname: '127.0.0.1',
  port: 8788,
  async fetch(req) {
    const url = new URL(req.url);
    let path = decodeURIComponent(url.pathname);
    if (path.includes('..')) return new Response('nope', { status: 400 });
    if (path === '/' || path === '') path = '/index.html';
    const file = Bun.file(ROOT + path);
    if (!(await file.exists())) return new Response('404 — not found', { status: 404 });
    const cache = path.startsWith('/assets/')
      ? 'public, max-age=86400'
      : 'no-cache';
    return new Response(file, { headers: { 'Cache-Control': cache } });
  },
});

console.log(`qi-site static server on http://127.0.0.1:${server.port}`);
