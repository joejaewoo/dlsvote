import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import state from '../api/state.js';
import vote from '../api/vote.js';
import admin from '../api/admin.js';
import { copyFonts } from './fonts.mjs';
copyFonts('public/fonts');

// Local-only defaults. Vercel never imports this file.
process.env.ADMIN_PASSWORD ||= '1234';
process.env.VOTER_SECRET ||= 'local-preview-voter-secret';
if (process.env.LOCAL_PREVIEW === '1') delete process.env.DATABASE_URL;
if (process.env.LOCAL_PREVIEW !== '1' && existsSync('.env.local')) {
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const match = line.match(/^([A-Z_]+)=(.*)$/);
    if (match && match[2]) process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
  }
}
const api = { '/api/state': state, '/api/vote': vote, '/api/admin': admin };
const contentTypes = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
const port = Number(process.env.PORT || 4173);
createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (api[url.pathname]) {
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 8192) { res.writeHead(413); res.end(); return; }
        chunks.push(chunk);
      }
      const request = new Request(url, { method: req.method, headers: req.headers,
        ...(req.method !== 'GET' && req.method !== 'HEAD' ? { body: Buffer.concat(chunks) } : {}) });
      const response = await api[url.pathname].fetch(request);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }
    const root = resolve('public');
    let file = ['/', '/vote', '/display', '/admin'].includes(url.pathname)
      ? resolve(root, 'index.html') : resolve(root, '.' + url.pathname);
    if (url.pathname === '/qrcode.js') file = resolve('node_modules/qrcode-generator/dist/qrcode.js');
    else if (!file.startsWith(root + '/')) { res.writeHead(403); res.end(); return; }
    if (!existsSync(file)) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': contentTypes[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(readFileSync(file));
  } catch { res.writeHead(500); res.end('Server error'); }
}).listen(port, '0.0.0.0', () => console.log(`즐거움 Live running on port ${port}`));
