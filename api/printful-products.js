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

// Printful keeps one real photo per print placement (front / back / sleeve, etc.) inside
// each variant's own "files" list — this pulls out every one of those, so a product with
// a front print AND a back print shows both instead of just one photo.
function variantImages(v) {
  const files = v.files || [];
  const urls = files
    .filter((f) => f.preview_url && /preview|mockup/i.test(f.type || ''))
    .map((f) => f.preview_url);
  return Array.from(new Set(urls)); // de-duplicate, keep order
}

// Printful's catalogue (not your store) already writes a material / fit / care description
// for every base product type (e.g. "Unisex Heavy Cotton Tee"). One lookup per catalogue
// product, cached, so ten colours of the same tee only cost one extra request.
const catalogCache = new Map();
async function catalogDescription(productId) {
  if (!productId) return '';
  if (catalogCache.has(productId)) return catalogCache.get(productId);
  let desc = '';
  try {
    const r = await pf('/products/' + productId);
    desc = (r && r.product && r.product.description) || '';
  } catch (e) { /* leave blank rather than fail the whole page */ }
  catalogCache.set(productId, desc);
  return desc;
}

// A real US-inch + EU-cm size chart, straight from Printful — only meaningful for
// wearable garments (t-shirts, hoodies), never fetched for postcards/posters/stickers.
// This one endpoint's exact shape isn't something we can test without a live account,
// so it fails quietly (no chart shown) rather than breaking the page if the shape differs.
const sizeCache = new Map();
async function catalogSizeChart(productId) {
  if (!productId) return null;
  if (sizeCache.has(productId)) return sizeCache.get(productId);
  let chart = null;
  try {
    // Printful's own docs (developers.printful.com) confirm this endpoint and its three
    // possible top-level sections, but don't publish the exact field names inside each
    // one — so instead of guessing those field names (which failed silently last time),
    // this keeps whichever sections Printful actually sends, as raw rows, and the page
    // renders them generically: whatever keys are actually present become the columns.
    const r = await pf('/products/' + productId + '/sizes?unit=inches,cm');
    if (r && typeof r === 'object') {
      const sections = ['measure_yourself', 'product_measure', 'international']
        .filter((k) => r[k])
        .map((k) => ({ key: k, data: r[k] }));
      if (sections.length) chart = sections;
    }
  } catch (e) { /* this product type has no size chart — skip quietly */ }
  sizeCache.set(productId, chart);
  return chart;
}

// Printful sells "framed" and "unframed" versions of the same poster design as two
// separate store products (that's how their dashboard organises things), so without
// this they'd show up as two separate cards everywhere on the site. Customers just
// think "this poster", so this merges every framed/unframed pair of the SAME design
// (matched by name, ignoring the frame/paper wording) into one product with one
// dropdown offering every size AND frame option together — and it applies wherever
// PRODUCTS is used (shop grid, edition pages, product page), because the merge
// happens here, before the front end ever sees the separate listings.
function posterGroupKey(title) {
  return title
    .replace(/\bposters?\b/ig, ' ')
    .replace(/\bno\s*frame\b/ig, ' ')
    .replace(/\bframed?\b/ig, ' ')
    .replace(/\benhanced\b/ig, ' ')
    .replace(/\bmatte\b/ig, ' ')
    .replace(/\bpaper\b/ig, ' ')
    .replace(/[-–]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}
function posterStyle(title) {
  return /framed/i.test(title) ? 'Framed' : 'Unframed';
}
function posterDisplayTitle(title) {
  return title
    .replace(/\bposters?\b/ig, 'Poster')
    .replace(/\bno\s*frame\b/ig, ' ')
    .replace(/\bframed?\b/ig, ' ')
    .replace(/\benhanced\b/ig, ' ')
    .replace(/\bmatte\b/ig, ' ')
    .replace(/\bpaper\b/ig, ' ')
    .replace(/[-–]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function mergePosterGroups(list) {
  const groups = new Map();
  const merged = [];
  for (const p of list) {
    if (p.dept !== 'prints') { merged.push(p); continue; }
    const key = posterGroupKey(p.title);
    const style = posterStyle(p.title);
    const taggedVariants = p.variants.map((v) => {
      const rest = v.name.split(' / ').slice(1).join(' / ');
      return Object.assign({}, v, { name: rest ? style + ' / ' + rest : style });
    });
    let g = groups.get(key);
    if (!g) {
      g = Object.assign({}, p, { title: posterDisplayTitle(p.title), variants: [], _careParts: [] });
      groups.set(key, g);
      merged.push(g);
    }
    g.variants = g.variants.concat(taggedVariants);
    if (p.care && g._careParts.indexOf(p.care) === -1) g._careParts.push(p.care);
  }
  merged.forEach((p) => {
    if (!p._careParts) return; // a non-poster product, passed through untouched
    p.care = p._careParts.join('\n\n');
    delete p._careParts;
    const symMatch = (p.variants[0] && p.variants[0].label.match(/^[^\d\-]+/)) || ['€'];
    const min = Math.min(...p.variants.map((v) => v.price));
    p.price = (p.variants.length > 1 ? 'From ' : '') + symMatch[0] + min.toFixed(2);
    p.desc = 'Produced to order and shipped by our print partner — framed or unframed, in several sizes. Prefer to print it yourself? Choose the digital option instead.';
  });
  return merged;
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
    const out = [];
    for (const d of details.filter(Boolean)) {
      const sp = d.sync_product;
      const vs = d.sync_variants.filter((v) => !v.is_ignored).map((v) => {
        const images = variantImages(v);
        return {
          id: v.id, name: v.name, price: Number(v.retail_price), label: money(v.retail_price, v.currency),
          image: images[0] || (v.product && v.product.image) || sp.thumbnail_url,
          images: images.length ? images : undefined, // multiple photos → gallery + zoom on the product page
        };
      });
      if (!vs.length) continue;
      const cur = (d.sync_variants[0] || {}).currency || 'EUR';
      const min = Math.min(...vs.map((v) => v.price));
      const catalogId = d.sync_variants[0] && d.sync_variants[0].product && d.sync_variants[0].product.product_id;
      const productDept = dept(sp.name);
      const isGarment = productDept === 't-shirts';
      const care = await catalogDescription(catalogId); // material, fit, care instructions, straight from Printful
      const sizeChart = isGarment ? await catalogSizeChart(catalogId) : null; // only fetched for wearables
      out.push({
        id: 'pf-' + sp.id, title: sp.name, dept: productDept, editions: [], kind: 'Physical',
        price: (vs.length > 1 ? 'From ' : '') + money(min, cur),
        thumb: sp.thumbnail_url, art: ['#58717A', '#252622'],
        desc: 'Produced to order and shipped by our print partner.',
        contents: ['Choose your size / option on this page', 'Produced and shipped by our print partner', 'Ships separately from digital items'],
        care,
        sizeChart,
        variants: vs,
      });
    }
    if (!out.length) throw new Error('No products returned (' + list.length + ' listed)');
    res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=86400');
    res.status(200).json(mergePosterGroups(out));
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(502).json({ error: String(e.message || e) });
  }
};
