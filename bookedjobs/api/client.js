const fs = require('fs');
const path = require('path');

module.exports = (req, res) => {
  const host = req.headers.host || req.headers['x-forwarded-host'] || '';

  // Extract subdomain: "squareelectric.bookedjobs.ca" → "squareelectric"
  const parts = host.replace(/:\d+$/, '').split('.');
  let subdomain = null;

  // Must have at least 3 parts (sub.bookedjobs.ca) and not be "www"
  if (parts.length >= 3 && parts[0] !== 'www') {
    subdomain = parts[0].toLowerCase().replace(/[^a-z0-9-]/g, '');
  }

  // Also support ?client= query param for direct testing
  if (!subdomain && req.query && req.query.client) {
    subdomain = req.query.client.toLowerCase().replace(/[^a-z0-9-]/g, '');
  }

  // Debug mode: show file system info to diagnose path issues
  if (req.query && req.query.debug === '1') {
    const cwd = process.cwd();
    const dirname = __dirname;
    let cwdFiles = [];
    let dirFiles = [];
    let clientsFromCwd = [];
    let clientsFromDir = [];

    try { cwdFiles = fs.readdirSync(cwd); } catch (e) { cwdFiles = [e.message]; }
    try { dirFiles = fs.readdirSync(dirname); } catch (e) { dirFiles = [e.message]; }
    try { clientsFromCwd = fs.readdirSync(path.join(cwd, 'clients')); } catch (e) { clientsFromCwd = [e.message]; }
    try { clientsFromDir = fs.readdirSync(path.join(dirname, '..', 'clients')); } catch (e) { clientsFromDir = [e.message]; }

    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({
      host,
      subdomain,
      cwd,
      dirname,
      cwdFiles,
      dirFiles,
      clientsFromCwd,
      clientsFromDir
    }, null, 2));
  }

  if (!subdomain) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/html');
    return res.end('<html><body><h1>404 — Page Not Found</h1><p><a href="https://bookedjobs.ca">Go to BookedJobs.ca</a></p></body></html>');
  }

  // Try multiple possible paths where Vercel may place included files
  const possiblePaths = [
    path.join(process.cwd(), 'clients', subdomain, 'index.html'),
    path.join(__dirname, '..', 'clients', subdomain, 'index.html'),
    path.join(__dirname, 'clients', subdomain, 'index.html'),
  ];

  let html = null;
  let usedPath = null;

  for (const p of possiblePaths) {
    try {
      if (fs.existsSync(p)) {
        html = fs.readFileSync(p, 'utf-8');
        usedPath = p;
        break;
      }
    } catch (e) {
      // continue trying
    }
  }

  if (html) {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    return res.end(html);
  }

  // Client not found — try custom 404
  const notFoundPaths = [
    path.join(process.cwd(), 'clients', '404.html'),
    path.join(__dirname, '..', 'clients', '404.html'),
    path.join(__dirname, 'clients', '404.html'),
  ];

  for (const p of notFoundPaths) {
    try {
      if (fs.existsSync(p)) {
        const html404 = fs.readFileSync(p, 'utf-8');
        res.statusCode = 404;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.end(html404);
      }
    } catch (e) {
      // continue
    }
  }

  res.statusCode = 404;
  res.setHeader('Content-Type', 'text/html');
  return res.end('<html><body><h1>404 — Client Not Found</h1><p><a href="https://bookedjobs.ca">Go to BookedJobs.ca</a></p></body></html>');
};
