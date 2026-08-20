// GET /api/twiml-forward?to=+17786834339
//   — Returns TwiML that dials `to`. Used as a Twilio number's Voice URL to forward inbound
//     calls to a real phone, for testing Irish numbers before they're wired to anything real.
//     Replaces twimlet.com/forward, which Twilio deprecated (now redirects to a Console page
//     instead of returning TwiML, breaking every call with a "Document parse failure").

const DEFAULT_FORWARD_TO = '+17786834339';

module.exports = function handler(req, res) {
  const to = typeof req.query.to === 'string' && /^\+[1-9]\d{6,14}$/.test(req.query.to)
    ? req.query.to
    : DEFAULT_FORWARD_TO;

  res.setHeader('Content-Type', 'text/xml');
  res.status(200).send(
    `<?xml version="1.0" encoding="UTF-8"?><Response><Dial>${to}</Dial></Response>`
  );
};
