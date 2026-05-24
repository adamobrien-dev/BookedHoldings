// GET /api/ds-debug — temporary, shows raw Dropbox Sign response
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const apiKey = process.env.DROPBOX_SIGN_API_KEY || '0c7c0852c085eeeb45c29567517edd91fe42cde48870c1d3bf0971dda88e6f11';
  const auth = 'Basic ' + Buffer.from(apiKey + ':').toString('base64');

  // Try without query filter — get everything
  const r = await fetch('https://api.hellosign.com/v3/signature_request/list?page_size=20', {
    headers: { Authorization: auth },
  });
  const text = await r.text();
  res.status(200).json({ status: r.status, body: JSON.parse(text) });
};
