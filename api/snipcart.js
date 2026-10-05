const TOKEN = process.env.PRINTFUL_API_TOKEN || process.env.PRINTFUL_TOKEN;
// GET /api/snipcart?id=...   (Snipcart's price check for items in the cart)
//   pf-<variantId>            -> physical Printful item, price = its Printful retail price
//   pf-<productId>-digital    -> digital download, price = same rule the shop page uses
//                                (60% of the physical price, rounded to €0.50, minimum €1)
const DIGITAL_PRICE_OVERRIDES = { 'standard postcard fog season cards': 1.5 }; // keep in sync with DIGITAL_TWINS in index.html
const norm = (s) => String(s).toLowerCase().replace(/\s+/g, ' ').trim();
module.exports = async (req, res) => {
  const raw = String(req.query.id || '');
  const m = raw.match(/^pf-(\d+)(-digital)?$/);
  if (!m) return res.status(404).json({ error: 'not found' });
  try {
    const h = { Authorization: 'Bearer ' + TOKEN };
    if (process.env.PRINTFUL_STORE_ID) h['X-PF-Store-Id'] = process.env.PRINTFUL_STORE_ID;
    res.setHeader('Cache-Control', 'no-store');
    if (!m[2]) {
      const r = await fetch('https://api.printful.com/store/variants/' + m[1], { headers: h });
      if (!r.ok) return res.status(404).json({ error: 'not found' });
      const v = (await r.json()).result.sync_variant;
      return res.status(200).json({ id: 'pf-' + v.id, price: Number(v.retail_price), url: req.url });
    }
    const r = await fetch('https://api.printful.com/store/products/' + m[1], { headers: h });
    if (!r.ok) return res.status(404).json({ error: 'not found' });
    const d = (await r.json()).result;
    const prices = d.sync_variants.filter((v) => !v.is_ignored).map((v) => Number(v.retail_price));
    if (!prices.length) return res.status(404).json({ error: 'not found' });
    const key = norm(d.sync_product.name);
    const price = DIGITAL_PRICE_OVERRIDES[key] || Math.max(1, Math.round(Math.min(...prices) * 0.6 * 2) / 2);
    return res.status(200).json({ id: raw, price, url: req.url });
  } catch (e) { res.status(502).json({ error: 'upstream' }); }
};
