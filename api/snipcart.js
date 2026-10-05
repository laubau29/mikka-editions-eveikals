const TOKEN = process.env.PRINTFUL_API_TOKEN || process.env.PRINTFUL_TOKEN;
// GET /api/snipcart?id=...   (Snipcart's price check for items in the cart)
//   pf-<variantId>            -> physical Printful item, price = its Printful retail price
//   pf-<productId>-digital    -> digital download, price = same rule the shop page uses
//                                (60% of the physical price, rounded to €0.50, minimum €1)
const DIGITAL_PRICE_OVERRIDES = { 'standard postcard fog season cards': 1.5 }; // keep in sync with DIGITAL_TWINS in index.html
// Snipcart compares the digital file code in the cart with this answer, so they must match.
// Keep in sync with DIGITAL_FILE_GUIDS in index.html (keyed here by Printful product id).
const FILE_GUIDS = {
  'pf-475425346': '6155fc46-07d1-427a-bd70-2ea3bc0bdbeb', // Poster Local Editions Paris My Paris
  'pf-475215332': '334baae0-00c7-4cee-a61d-5737d6bd3e28', // Standard Postcard Little Elsewhere Cards Somewhere
  'pf-475424872': '97326829-9e55-4a2b-872e-6abe6706b949'  // Standard Postcard Local Editions Paris My Paris
};
// Same codes, matched by product name (start of the name) for products whose id is not listed above.
const FILE_GUIDS_BY_NAME = {
  'poster little elsewhere': 'dd00a812-7222-4c8d-9958-53b644ee1e99',
  'poster local editions little elsewhere': 'dd00a812-7222-4c8d-9958-53b644ee1e99'
};
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
    const out = { id: raw, price, url: req.url, shippable: false };
    let g = FILE_GUIDS['pf-' + m[1]];
    if (!g) { const k = Object.keys(FILE_GUIDS_BY_NAME).find((n) => key === n || key.startsWith(n + ' ')); if (k) g = FILE_GUIDS_BY_NAME[k]; }
    if (g) out.fileGuid = g;
    return res.status(200).json(out);
  } catch (e) { res.status(502).json({ error: 'upstream' }); }
};
