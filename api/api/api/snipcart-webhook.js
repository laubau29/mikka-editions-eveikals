// Accepts either variable name in Vercel: PRINTFUL_API_TOKEN or PRINTFUL_TOKEN
const TOKEN = process.env.PRINTFUL_API_TOKEN || process.env.PRINTFUL_TOKEN;
// POST /api/snipcart-webhook  (Snipcart dashboard → Webhooks, event: order.completed)
// Creates a Printful order for the "pf-" items in a completed Snipcart order.
// Orders are created as DRAFTS unless PRINTFUL_AUTO_CONFIRM=true (Printful charges you on confirm).
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();
  try {
    // 1) Make sure the request really comes from Snipcart
    const token = req.headers['x-snipcart-requesttoken'];
    if (!token) return res.status(401).end();
    const basic = 'Basic ' + Buffer.from(process.env.SNIPCART_SECRET_KEY + ':').toString('base64');
    const check = await fetch('https://app.snipcart.com/api/requestvalidation/' + token, { headers: { Authorization: basic, Accept: 'application/json' } });
    if (!check.ok) return res.status(401).end();

    // 2) Only handle completed orders
    const { eventName, content: o } = req.body || {};
    if (eventName !== 'order.completed') return res.status(200).end();

    // 3) Keep Printful items only (digital items etc. are ignored here)
    const items = (o.items || []).filter((i) => String(i.id).startsWith('pf-'))
      .map((i) => ({ sync_variant_id: Number(String(i.id).slice(3)), quantity: i.quantity }));
    if (!items.length) return res.status(200).end();

    const a = o.shippingAddress || o.billingAddress;
    const order = {
      external_id: String(o.invoiceNumber),
      recipient: { name: a.fullName || a.name, address1: a.address1, address2: a.address2 || '', city: a.city,
                   state_code: a.province || '', country_code: a.country, zip: a.postalCode, phone: a.phone || '', email: o.email },
      items,
    };
    const h = { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' };
    if (process.env.PRINTFUL_STORE_ID) h['X-PF-Store-Id'] = process.env.PRINTFUL_STORE_ID;
    const confirm = process.env.PRINTFUL_AUTO_CONFIRM === 'true' ? '?confirm=true' : '';
    const r = await fetch('https://api.printful.com/orders' + confirm, { method: 'POST', headers: h, body: JSON.stringify(order) });
    res.status(r.ok ? 200 : 502).json({ ok: r.ok }); // non-200 makes Snipcart retry
  } catch (e) {
    res.status(500).end();
  }
};
