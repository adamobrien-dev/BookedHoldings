// Local dev server — serves static files + wires /api/* to Vercel handlers
const http = require('http');
const fs   = require('fs');
const path = require('path');
const url  = require('url');

require('dotenv').config({ path: path.join(__dirname, '../.env') });

const STATIC_ROOT = __dirname;
const API_DIR     = path.join(__dirname, 'api');
const PORT        = 3000;

const MIME = {
  '.html': 'text/html',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.json': 'application/json',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.mp4':  'video/mp4',
};

function makeRes(rawRes) {
  const headers = {};
  const res = {
    statusCode: 200,
    setHeader(k, v) { headers[k] = v; },
    status(code) { res.statusCode = code; return res; },
    end(body) {
      rawRes.writeHead(res.statusCode, headers);
      rawRes.end(body || '');
    },
    json(data) {
      headers['Content-Type'] = 'application/json';
      rawRes.writeHead(res.statusCode, headers);
      rawRes.end(JSON.stringify(data));
    },
  };
  return res;
}

function makeReq(rawReq, parsedUrl) {
  return {
    method: rawReq.method,
    query:  Object.fromEntries(new URLSearchParams(parsedUrl.query)),
    headers: rawReq.headers,
    body:   null,
  };
}

const server = http.createServer(async (rawReq, rawRes) => {
  const parsed  = url.parse(rawReq.url);
  let pathname  = parsed.pathname;

  // Rewrite /platform -> /dashboard
  if (pathname === '/platform' || pathname === '/platform/') pathname = '/dashboard';

  // API routing
  if (pathname.startsWith('/api/')) {
    const name    = pathname.slice(5).replace(/\/$/, '');
    const handler = path.join(API_DIR, name + '.js');
    if (fs.existsSync(handler)) {
      // Clear require cache so edits are picked up
      delete require.cache[require.resolve(handler)];
      try {
        const fn  = require(handler);
        const req = makeReq(rawReq, parsed);
        const res = makeRes(rawRes);
        await fn(req, res);
      } catch (e) {
        rawRes.writeHead(500, { 'Content-Type': 'application/json' });
        rawRes.end(JSON.stringify({ error: e.message, stack: e.stack }));
      }
    } else {
      rawRes.writeHead(404);
      rawRes.end('API not found: ' + name);
    }
    return;
  }

  // Static file serving
  let filePath = path.join(STATIC_ROOT, pathname);
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  }
  if (!fs.existsSync(filePath)) {
    rawRes.writeHead(404);
    rawRes.end('Not found: ' + pathname);
    return;
  }
  const ext = path.extname(filePath);
  rawRes.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(rawRes);
});

server.listen(PORT, () => console.log('Dev server → http://localhost:' + PORT + '/platform'));
