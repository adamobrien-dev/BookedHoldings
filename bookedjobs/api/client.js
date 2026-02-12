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

  if (!subdomain) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/html');
    return res.end('<html><body><h1>404 — Page Not Found</h1><p><a href="https://bookedjobs.ca">Go to BookedJobs.ca</a></p></body></html>');
  }

  // Resolve the client HTML file
  const htmlPath = path.join(process.cwd(), 'clients', subdomain, 'index.html');

  try {
    if (!fs.existsSync(htmlPath)) {
      // Try the 404 page
      const notFoundPath = path.join(process.cwd(), 'clients', '404.html');
      if (fs.existsSync(notFoundPath)) {
        const html404 = fs.readFileSync(notFoundPath, 'utf-8');
        res.statusCode = 404;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.end(html404);
      }
      res.statusCode = 404;
      res.setHeader('Content-Type', 'text/html');
      return res.end('<html><body><h1>404 — Client Not Found</h1><p><a href="https://bookedjobs.ca">Go to BookedJobs.ca</a></p></body></html>');
    }

    const html = fs.readFileSync(htmlPath, 'utf-8');
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    return res.end(html);
  } catch (err) {
    console.error('Error serving client page:', err);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'text/html');
    return res.end('<html><body><h1>500 — Server Error</h1></body></html>');
  }
};
