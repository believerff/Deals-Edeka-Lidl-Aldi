// Netlify Function: собирает скидки Lidl / Aldi Nord / Edeka для твоего индекса через Marktguru.
// Адрес на сайте: /api/deals   (диагностика: /api/deals?debug=1,  другой индекс: /api/deals?zip=21376)

const DEFAULT_ZIP = '21376'; // Salzhausen
const API = 'https://api.marktguru.de/api/v1/offers/search';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
// Публичные ключи веб-клиента Marktguru. Если перестанут работать — функция сама достанет новые с marktguru.de.
const KNOWN_KEYS = { apiKey: '8Kk+pmbf7TgJ9nVj2cXeA7P5zBGv8iuutVVMRfOfvNE=', clientKey: 'WU/RH+PMGDi+gkZer3WbMelt6zcYHSTytNB7VpTia90=' };

const STORES = {
  lidl:  { name: 'Lidl',        re: /\blidl\b/i },
  aldi:  { name: 'Aldi Nord',   re: /aldi[\s-]*nord/i },
  edeka: { name: 'Edeka Düver', re: /edeka/i,
           note: 'Предложения Edeka показаны для региона твоего индекса (как в листовке). В конкретном рынке (Düver) ассортимент и цены могут немного отличаться.' }
};
const TERMS = ['milch','käse','joghurt','butter','eier','fleisch','hähnchen','hackfleisch','schinken','wurst','lachs','fisch','brot','brötchen',
  'obst','gemüse','kartoffeln','nudeln','reis','mehl','zucker','öl','soße','tomaten','schokolade','chips','kekse','eis','pizza','tiefkühl',
  'suppe','kaffee','tee','saft','wasser','cola','bier','wein','müsli','aufstrich','nüsse','kuchen','salat','sahne','quark','konserve'];
const NON_FOOD = /elektro|haushalt|garten|bekleidung|mode|spiel|baumarkt|heimwerk|möbel|auto|tier|büro|sport|drogerie|kosmetik|pflege|reinigung|wasch|lampe|werkzeug|deko/i;

const USES = { cook: '🍳 Для готовки', tasty: '😋 Вкусняшки', ready: '🥪 Готовое к еде', drink: '🥤 Напитки', fresh: '🥬 Свежее', other: 'Другое' };
const USE_RULES = [
  ['drink', /saft|wasser|cola|limo|sprudel|\bbier|\bwein|sekt|kaffee|\btee\b|energy|smoothie|schorle|likör|whisk|vodka|\bgin\b|getränk/i],
  ['tasty', /schoko|keks|kuchen|riegel|gummi|chips|snack|\beis\b|bonbon|praline|waffel|marzipan|popcorn|kitkat|lion|milka|haribo|nutella|lebkuchen|stollen|plätzchen|gebäck|torte|dessert|pudding|nuss|nüsse|trockenfrüchte|honig|konfekt|süß/i],
  ['ready', /pizza|fertig|suppe|burger|nugget|schinken|wurst|salami|aufschnitt|aufstrich|käse|brötchen|\bbrot\b|sandwich|döner|lasagne|salat|\bdip\b|joghurt|skyr|quark|tiefkühl|baguette|croissant|backwaren/i],
  ['cook', /mehl|zucker|\böl\b|essig|reis|nudel|pasta|sauce|soße|gewürz|hack|fleisch|schnitzel|kotelett|filet|steak|entrec|butter|sahne|rahm|\bei(er)?\b|tomate|passiert|mais|bohnen|linsen|zwiebel|kartoffel|brühe|fond|koch|back|hefe|füllung|milch|molkerei|gulasch|geflügel|hähnchen|lachs|fisch|konserve/i],
  ['fresh', /obst|gemüse|birne|apfel|äpfel|banane|gurke|zucchini|paprika|möhre|karotte|beere|traube|orange|zitrone|kiwi|avocado|pilz/i]
];
const classifyUse = (t) => { for (const [u, re] of USE_RULES) if (re.test(t)) return u; return 'other'; };

const num = (v) => { const n = typeof v === 'string' ? parseFloat(v.replace(',', '.')) : Number(v); return Number.isFinite(n) ? n : null; };
const day = (s) => (s ? String(s).slice(0, 10) : '');

function tf(url, opts, ms) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  return fetch(url, { ...opts, signal: c.signal }).finally(() => clearTimeout(t));
}

async function discoverKeys() {
  try {
    const r = await tf('https://www.marktguru.de/', { headers: { 'user-agent': UA, accept: 'text/html' } }, 5000);
    if (!r.ok) return null;
    const t = (await r.text()).replace(/&quot;/g, '"');
    const a = t.match(/"apiKey"\s*:\s*"([^"]+)"/), c = t.match(/"clientKey"\s*:\s*"([^"]+)"/);
    return a && c ? { apiKey: a[1], clientKey: c[1] } : null;
  } catch { return null; }
}

export function mapOffer(r, now = Date.now()) {
  const advObj = r.advertisers && r.advertisers[0];
  const adv = (advObj && (advObj.name || advObj.uniqueName)) || '';
  const store = Object.keys(STORES).find(k => STORES[k].re.test(adv));
  if (!store) return null;
  const price = num(r.price);
  if (!(price > 0)) return null;
  const catName = (r.categories && r.categories[0] && r.categories[0].name) || '';
  if (NON_FOOD.test(catName)) return null;
  const v = r.validityDates && r.validityDates[0];
  const to = day(v && v.to), from = day(v && v.from);
  if (to && Date.parse(to) < now - 864e5) return null; // уже закончилось
  const name = String((r.product && r.product.name) || r.title || r.description || '').trim();
  if (!name) return null;
  const brand = String((r.brand && r.brand.name) || '').trim();
  const oldP = num(r.oldPrice ?? r.originalPrice);
  const old = oldP && oldP > price ? oldP : null;
  const ref = num(r.referencePrice);
  const unitShort = r.unit && (r.unit.shortName || r.unit.name);
  const imgUrls = r.images && (r.images.urls || r.images);
  const img = (imgUrls && (imgUrls.medium || imgUrls.large || imgUrls.small)) ||
    (r.id ? `https://mg2de.b-cdn.net/api/v1/offers/${r.id}/images/default/0/medium.webp` : '');
  const cat = catName ? catName.toLowerCase().replace(/[^a-zäöüß0-9]+/g, '-').replace(/^-|-$/g, '') : 'sonstiges';
  return {
    id: `${store}|${r.id ?? name + price}`, store, name, brand,
    desc: String(r.description || '').trim().slice(0, 160),
    price, old, discount: old ? Math.round((1 - price / old) * 100) : null,
    unit: ref && unitShort ? `1 ${unitShort} = ${ref.toFixed(2)}` : '',
    unitPrice: ref && /^(kg|l)$/i.test(unitShort || '') ? ref : null,
    unitBase: ref && /^(kg|l)$/i.test(unitShort || '') ? String(unitShort).toLowerCase() : null,
    img, link: `https://www.marktguru.de/search/${encodeURIComponent(name)}`,
    use: classifyUse(`${name} ${brand} ${catName}`), cat, catName, from, to
  };
}

async function pool(items, n, fn) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } }));
  return out;
}

export default async (req) => {
  const url = new URL(req.url);
  const zip = /^\d{5}$/.test(url.searchParams.get('zip') || '') ? url.searchParams.get('zip') : DEFAULT_ZIP;
  const debug = url.searchParams.has('debug');
  const deadline = Date.now() + 8000;
  const log = { zip, keys: 'known', calls: [], sample: null };
  let keys = KNOWN_KEYS;

  const call = async (term) => {
    if (Date.now() > deadline) { log.calls.push({ term, skipped: true }); return []; }
    try {
      const r = await tf(`${API}?as=web&limit=200&offset=0&q=${encodeURIComponent(term)}&zipCode=${zip}`,
        { headers: { 'x-apikey': keys.apiKey, 'x-clientkey': keys.clientKey, accept: 'application/json', 'user-agent': UA } }, 6000);
      if (!r.ok) { log.calls.push({ term, status: r.status }); return r.status === 401 || r.status === 403 ? null : []; }
      const j = await r.json();
      const res = Array.isArray(j.results) ? j.results : [];
      if (!log.sample && res[0]) log.sample = JSON.stringify(res[0]).slice(0, 1800);
      log.calls.push({ term, status: 200, n: res.length });
      return res;
    } catch (e) { log.calls.push({ term, error: e.name }); return []; }
  };

  // проба: если ключи отклонены — достаём новые с сайта
  let first = await call(TERMS[0]);
  if (first === null) {
    const nk = await discoverKeys();
    if (nk) { keys = nk; log.keys = 'discovered'; first = await call(TERMS[0]); }
    else log.keys = 'rejected, discovery failed';
  }
  const rest = await pool(TERMS.slice(1), 8, call);
  const raw = [first || [], ...rest.map(x => x || [])].flat();

  const seen = new Set(), deals = [];
  for (const r of raw) {
    const d = mapOffer(r);
    if (d && !seen.has(d.id)) { seen.add(d.id); deals.push(d); }
  }

  const pairs = {};
  deals.forEach(d => { if (d.from && d.to) pairs[d.from + '|' + d.to] = (pairs[d.from + '|' + d.to] || 0) + 1; });
  const top = Object.entries(pairs).sort((a, b) => b[1] - a[1])[0];
  const week = top ? { from: top[0].split('|')[0], to: top[0].split('|')[1] } : null;

  const cats = {};
  deals.forEach(d => { if (d.catName) cats[d.cat] = d.catName; });
  const stores = {};
  for (const [k, s] of Object.entries(STORES)) {
    stores[k] = { name: s.name, count: deals.filter(d => d.store === k).length, ...(s.note ? { note: s.note } : {}) };
  }
  const body = { ok: deals.length > 0, updatedAt: new Date().toISOString(), week, source: 'marktguru.de', zip, cats, uses: USES, stores, deals };

  if (debug) {
    return new Response(JSON.stringify({ summary: { raw: raw.length, deals: deals.length, stores: Object.fromEntries(Object.entries(stores).map(([k, v]) => [k, v.count])) }, ...log }, null, 1),
      { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
  }
  if (!deals.length) {
    return new Response(JSON.stringify({ ok: false, error: 'no deals', calls: log.calls.slice(0, 5) }), { status: 502, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
  }
  return new Response(JSON.stringify(body), { headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'public, max-age=600',
    'netlify-cdn-cache-control': 'public, s-maxage=21600, stale-while-revalidate=86400'
  } });
};

export const config = { path: '/api/deals' };
