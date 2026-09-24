// GET /api/printful-products — reads your Printful (Manual order / API) store products.
// Token stays server-side. Uses small batches + retries so Printful rate limits don't break the page.
const TOKEN = process.env.PRINTFUL_API_TOKEN || process.env.PRINTFUL_TOKEN;
const SYM = { EUR: '€', USD: '$', GBP: '£' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const money = (v, c) => (SYM[c] || c + ' ') + Number(v).toFixed(2);
const dept = (n) =>
  /shirt|tee|hoodie|sweat/i.test(n) ? 't-shirts' :
  /sticker/i.test(n) ? 'stickers' :
  /card/i.test(n) ? 'cards' : 'prints'; // anything else (mugs, etc.) goes to "prints" for now

async function pf(path, tries = 4) {
  const h = { Authorization: 'Bearer ' + TOKEN };
  if (process.env.PRINTFUL_STORE_ID) h['X-PF-Store-Id'] = process.env.PRINTFUL_STORE_ID;
  for (let i = 0; i < tries; i++) {
    const r = await fetch('https://api.printful.com' + path, { headers: h });
    if (r.ok) return (await r.json()).result;
    if ((r.status === 429 || r.status >= 500) && i < tries - 1) { await sleep(1200 * (i + 1)); continue; }
    let msg = ''; try { const j = await r.json(); msg = (j.error && (j.error.message || j.error)) || ''; } catch (e) {}
    throw new Error('Printful ' + r.status + ' ' + msg + ' (' + path + ')');
  }
}

module.exports = async (req, res) => {
  if (!TOKEN) return res.status(500).json({ error: 'Token missing: add PRINTFUL_API_TOKEN in Vercel and redeploy' });
  try {
    const list = (await pf('/store/products?limit=100')).filter((p) => !p.is_ignored);
    const details = [];
    for (let i = 0; i < list.length; i += 4) { // 4 at a time
      const part = await Promise.all(list.slice(i, i + 4).map((p) => pf('/store/products/' + p.id).catch(() => null)));
      details.push(...part);
    }
    const out = details.filter(Boolean).map((d) => {
      const sp = d.sync_product;
      const vs = d.sync_variants.filter((v) => !v.is_ignored).map((v) => {
        const prev = (v.files || []).find((f) => f.type === 'preview');
        return { id: v.id, name: v.name, price: Number(v.retail_price), label: money(v.retail_price, v.currency),
                 image: (prev && prev.preview_url) || (v.product && v.product.image) || sp.thumbnail_url };
      });
      const cur = (d.sync_variants[0] || {}).currency || 'EUR';
      const min = vs.length ? Math.min(...vs.map((v) => v.price)) : 0;
      return {
        id: 'pf-' + sp.id, title: sp.name, dept: dept(sp.name), editions: [], kind: 'Physical',
        price: vs.length ? (vs.length > 1 ? 'From ' : '') + money(min, cur) : '',
        thumb: sp.thumbnail_url, art: ['#58717A', '#252622'],
        desc: 'Produced to order and shipped by our print partner.',
        contents: ['Choose your size / option on this page', 'Produced and shipped by our print partner', 'Ships separately from digital items'],
        variants: vs,
      };
    }).filter((p) => p.variants.length);
    if (!out.length) throw new Error('No products returned (' + list.length + ' listed)');
    res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=86400');
    res.status(200).json(out);
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(502).json({ error: String(e.message || e) });
  }
};
