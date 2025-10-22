// api/index.js
// Node.js serverless handler for Vercel (CommonJS / Next.js style)

const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

const DEFAULT_JUSPAY = 'https://api.juspay.in/upi/verify-vpa';

// small concurrency helper
async function concurrentMap(items, mapper, concurrency = 5) {
  const results = [];
  let i = 0;
  const workers = new Array(concurrency).fill(null).map(async () => {
    while (true) {
      const idx = i++;
      if (idx >= items.length) return;
      try {
        results[idx] = await mapper(items[idx], idx);
      } catch (err) {
        results[idx] = { error: String(err) };
      }
    }
  });
  await Promise.all(workers);
  return results;
}

module.exports = async (req, res) => {
  // allow CORS for demonstration (modify for production)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const JUSPAY_URL = process.env.JUSPAY_URL || DEFAULT_JUSPAY;

  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname || '/api';

    // GET /api/verify?vpa=<vpa>
    if ((req.method === 'GET' || req.method === 'POST') && (url.searchParams.get('vpa') || (req.body && req.body.vpa))) {
      const vpa = url.searchParams.get('vpa') || (req.body && req.body.vpa);
      if (!vpa || !vpa.includes('@')) return res.status(400).json({ error: 'please provide a full VPA like user@bank' });

      const response = await fetch(JUSPAY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Connection': 'close' },
        body: new URLSearchParams({ vpa: vpa, merchant_id: 'milaap' }),
        timeout: 15000,
      });

      const json = await response.json().catch(() => ({ status: 'ERROR', raw: null }));
      return res.status(response.status || 200).json({ source: 'juspay', api_url: JUSPAY_URL, vpa, result: json });
    }

    // POST /api/scan-phone  { phone: '9999999999', threads: 4 }
    if (req.method === 'POST' && url.pathname.endsWith('/scan-phone')) {
      const body = req.body || JSON.parse(req.rawBody || '{}');
      const phone = (body.phone || '').toString().trim();
      const threads = Number(body.threads) || 4;

      if (!phone) return res.status(400).json({ error: 'phone is required' });

      // normalize phone: handle prefixed 91
      const searchtext = (phone.startsWith('91') && phone.length > 10) ? phone.slice(2) : phone;
      if (!/^[0-9]{10}$/.test(searchtext)) return res.status(400).json({ error: 'phone must be a 10-digit number (optionally starting with 91)' });

      // load suffix list from data/mobile_suffixes.txt
      const suffixPath = path.join(__dirname, '..', 'data', 'mobile_suffixes.txt');
      if (!fs.existsSync(suffixPath)) return res.status(500).json({ error: 'suffix file missing on server; upload data/mobile_suffixes.txt' });

      const suffixes = fs.readFileSync(suffixPath, 'utf8').split(/\r?\n/).filter(Boolean);

      const candidates = suffixes.map(s => `${searchtext}@${s}`);

      // query with limited concurrency
      const results = await concurrentMap(candidates, async (vpa) => {
        const r = await fetch(JUSPAY_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Connection': 'close' },
          body: new URLSearchParams({ vpa: vpa, merchant_id: 'milaap' }),
          timeout: 15000,
        }).catch(err => ({ ok: false, error: String(err) }));

        if (!r || !r.ok) return { vpa, ok: false, error: r && r.error ? r.error : `HTTP ${r && r.status}` };
        const json = await r.json().catch(() => null);
        return { vpa, ok: true, response: json };
      }, Math.min(10, Math.max(1, threads)));

      // filter positives
      const found = results.filter(x => x.ok && x.response && x.response.status === 'VALID');

      return res.json({ scanned: candidates.length, found, raw_count: results.length });
    }

    // If user hits /api (root) show a small help message
    if (req.method === 'GET') {
      return res.json({ message: 'UPI Recon API: use /api/verify?vpa=user@bank or POST /api/scan-phone', example_verify: '/api?&vpa=9999999999@okicici' });
    }

    return res.status(404).json({ error: 'not found' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: String(err) });
  }
};
