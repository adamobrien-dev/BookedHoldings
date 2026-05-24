// GET /api/ds-debug — temporary, shows raw Dropbox Sign response
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const apiKey = process.env.DROPBOX_SIGN_API_KEY || '0c7c0852c085eeeb45c29567517edd91fe42cde48870c1d3bf0971dda88e6f11';
  const auth = 'Basic ' + Buffer.from(apiKey + ':').toString('base64');

  const r = await fetch('https://api.hellosign.com/v3/signature_request/list?page_size=100', {
    headers: { Authorization: auth },
  });
  const data = await r.json();
  const requests = data?.signature_requests || [];
  res.status(200).json({
    httpStatus: r.status,
    total: requests.length,
    unsigned: requests.filter(sr => !sr.is_complete && !sr.is_declined).length,
    contracts: requests.map(sr => ({
      id: sr.signature_request_id,
      title: sr.title,
      is_complete: sr.is_complete,
      is_declined: sr.is_declined,
      createdAt: new Date(sr.created_at * 1000).toISOString(),
      signerName: sr.signatures?.[0]?.signer_name,
      signerEmail: sr.signatures?.[0]?.signer_email_address,
      signerStatus: sr.signatures?.[0]?.status_code,
    })),
  });
};
