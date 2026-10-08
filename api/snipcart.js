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
  'poster little elsewhere': '704bb20d-e411-4aa0-88e7-f92d3776cc63',
  'poster local editions little elsewhere': '704bb20d-e411-4aa0-88e7-f92d3776cc63'
};
const norm = (s) => String(s).toLowerCase().replace(/\s+/g, ' ').trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Ask Printful, retrying a few times when it is busy or has a hiccup.
async function pfGet(path, h) {
  let last;
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch('https://api.printful.com' + path, { headers: h });
      if (r.ok) return (await r.json()).result;
      last = r.status;
      if (r.status !== 429 && r.status < 500) return null; // a real "not found"
    } catch (e) { last = String(e); }
    await sleep(500 * (i + 1));
  }
  throw new Error('Printful ' + last);
}
// The shop page already caches the full product list for 10 minutes; reuse it so
// we usually do not need to bother Printful at all.
async function fromShopList(req, productId) {
  try {
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const r = await fetch('https://' + host + '/api/printful-products');
    if (!r.ok) return null;
    const list = await r.json();
    const p = list.find((x) => x.id === 'pf-' + productId);
    if (!p) return null;
    // use the exact price shown on the page ("From €7.50" -> 7.5) so both always agree
    const shown = parseFloat(String(p.price).replace(/[^0-9.]/g, ''));
    if (!shown) return null;
    return { name: p.title, prices: [shown] };
  } catch (e) { return null; }
}
module.exports = async (req, res) => {
  const raw = String(req.query.id || '');
  const m = raw.match(/^pf-(\d+)(-digital)?$/);
  if (!m) return res.status(404).json({ error: 'not found' });
  try {
    const h = { Authorization: 'Bearer ' + TOKEN };
    if (process.env.PRINTFUL_STORE_ID) h['X-PF-Store-Id'] = process.env.PRINTFUL_STORE_ID;
    res.setHeader('Cache-Control', 'no-store');
    if (!m[2]) {
      const result = await pfGet('/store/variants/' + m[1], h);
      if (!result) return res.status(404).json({ error: 'not found' });
      const v = result.sync_variant;
      return res.status(200).json({ id: 'pf-' + v.id, price: Number(v.retail_price), url: req.url });
    }
    let info = await fromShopList(req, m[1]);
    if (!info) {
      const d = await pfGet('/store/products/' + m[1], h);
      if (!d) return res.status(404).json({ error: 'not found' });
      info = { name: d.sync_product.name, prices: d.sync_variants.filter((v) => !v.is_ignored).map((v) => Number(v.retail_price)) };
    }
    if (!info.prices.length) return res.status(404).json({ error: 'not found' });
    const key = norm(info.name);
    const price = DIGITAL_PRICE_OVERRIDES[key] || Math.max(1, Math.round(Math.min(...info.prices) * 0.6 * 2) / 2);
    const out = { id: raw, price, url: req.url, shippable: false };
    let g = FILE_GUIDS['pf-' + m[1]];
    if (!g) { const k = Object.keys(FILE_GUIDS_BY_NAME).find((n) => key === n || key.startsWith(n + ' ')); if (k) g = FILE_GUIDS_BY_NAME[k]; }
    if (g) out.fileGuid = g;
    return res.status(200).json(out);
  } catch (e) { res.status(502).json({ error: 'upstream' }); }
};
