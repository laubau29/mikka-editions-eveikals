// Accepts either variable name in Vercel: PRINTFUL_API_TOKEN or PRINTFUL_TOKEN
const TOKEN = process.env.PRINTFUL_API_TOKEN || process.env.PRINTFUL_TOKEN;
// GET /api/printful-products
// Reads your Printful store's synced products. The token lives only in the
// Vercel environment variable PRINTFUL_TOKEN and is never sent to the browser.
const SYM = { EUR: '€', USD: '$', GBP: '£' };
const pf = async (path) => {
  const h = { Authorization: 'Bearer ' + TOKEN };
  if (process.env.PRINTFUL_STORE_ID) h['X-PF-Store-Id'] = process.env.PRINTFUL_STORE_ID; // only for account-level tokens
  const r = await fetch('https://api.printful.com' + path, { headers: h });
  if (!r.ok) {
    let msg = ''; try { const j = await r.json(); msg = (j.error && (j.error.message || j.error)) || j.result || ''; } catch (e) {}
    throw new Error('Printful ' + r.status + ' ' + msg + ' (' + path + ')');
  }
  return (await r.json()).result;
};
const dept = (n) =>
  /shirt|tee|hoodie|sweat/i.test(n) ? 't-shirts' :
  /sticker/i.test(n) ? 'stickers' :
  /card/i.test(n) ? 'cards' : 'prints'; // anything else (mugs, etc.) lands in "prints" for now
const money = (v, c) => (SYM[c] || c + ' ') + Number(v).toFixed(2);

module.exports = async (req, res) => {
  if (!TOKEN) return res.status(500).json({ error: 'Token missing: add PRINTFUL_API_TOKEN in Vercel and redeploy' });
  try {
    const list = (await pf('/store/products?limit=100')).filter((p) => !p.is_ignored);
    const details = await Promise.all(list.map((p) => pf('/store/products/' + p.id)));
    const out = details.map((d) => {
      const sp = d.sync_product;
      const vs = d.sync_variants.filter((v) => !v.is_ignored).map((v) => {
        const prev = (v.files || []).find((f) => f.type === 'preview');
        return { id: v.id, name: v.name, price: Number(v.retail_price), label: money(v.retail_price, v.currency),
                 image: (prev && prev.preview_url) || (v.product && v.product.image) || sp.thumbnail_url };
      });
      const min = vs.length ? Math.min(...vs.map((v) => v.price)) : 0;
      return {
        id: 'pf-' + sp.id, title: sp.name, dept: dept(sp.name), editions: [], kind: 'Physical',
        price: vs.length ? (vs.length > 1 ? 'From ' : '') + money(min, (d.sync_variants[0] || {}).currency || 'EUR') : '',
        thumb: sp.thumbnail_url, art: ['#58717A', '#252622'],
        desc: 'Produced to order and shipped by our print partner.',
        contents: ['Choose your size / option on this page', 'Produced and shipped by our print partner', 'Ships separately from digital items'],
        variants: vs,
      };
    }).filter((p) => p.variants.length);
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    res.status(200).json(out);
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
};
