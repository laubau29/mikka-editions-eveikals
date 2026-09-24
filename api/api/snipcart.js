// Accepts either variable name in Vercel: PRINTFUL_API_TOKEN or PRINTFUL_TOKEN
const TOKEN = process.env.PRINTFUL_API_TOKEN || process.env.PRINTFUL_TOKEN;
// GET /api/snipcart?id=pf-<syncVariantId>
// Snipcart's crawler does not run JavaScript, so it validates prices here (JSON crawler).
module.exports = async (req, res) => {
  const id = String(req.query.id || '').replace(/^pf-/, '');
  if (!/^\d+$/.test(id)) return res.status(404).json({ error: 'not found' });
  try {
    const h = { Authorization: 'Bearer ' + TOKEN };
    if (process.env.PRINTFUL_STORE_ID) h['X-PF-Store-Id'] = process.env.PRINTFUL_STORE_ID;
    const r = await fetch('https://api.printful.com/store/variants/' + id, { headers: h });
    if (!r.ok) return res.status(404).json({ error: 'not found' });
    const v = (await r.json()).result.sync_variant;
    res.setHeader('Cache-Control', 'no-store');
    // "url" must match the data-item-url used on the button
    res.status(200).json({ id: 'pf-' + v.id, price: Number(v.retail_price), url: req.url });
  } catch (e) {
    res.status(502).json({ error: 'upstream' });
  }
};
