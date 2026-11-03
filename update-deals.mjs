// Раз в неделю собирает скидки Lidl / Aldi Nord / Edeka и пишет deals.json.
// Запуск: node update-deals.mjs   (нужен Node 18+, без зависимостей)
import { writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export const STORES = {
  lidl:  { name: 'Lidl',        slug: 'lidl',        match: /lidl/i },
  aldi:  { name: 'Aldi Nord',   slug: 'aldinord-de', match: /aldi/i, itemized: false,
           link: 'https://www.meinprospekt.de/aldinord-de',
           note: 'У Aldi Nord нет поштучных скидок в открытых источниках — публикуется только листовка-картинка.' },
  edeka: { name: 'Edeka Düver', slug: 'edeka',       match: /edeka/i,
           note: 'Edeka работает по регионам: источник выбирает регион по месту запроса, поэтому предложения могут не совпадать с Edeka Düver. Сверяйся с листовкой в магазине.' }
};
export const CATS = [
  ['lebensmittel', 'Разное'], ['fleisch', 'Мясо'], ['wurst', 'Колбаса и ветчина'], ['kaese', 'Сыр'],
  ['milch', 'Молочное'], ['gemuese', 'Овощи'], ['obst', 'Фрукты'], ['brot', 'Хлеб и выпечка'],
  ['getraenke', 'Напитки'], ['schokolade', 'Сладкое'], ['tiefkuehlkost', 'Заморозка'], ['kaffee', 'Кофе']
];

const decode = (s) => s.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#0?39;|&apos;/g, "'").replace(/&euro;/g, '€').replace(/&nbsp;/g, ' ');
const strip = (s) => decode(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const toPrice = (s) => { const m = String(s).match(/(\d+),(\d{1,2})/); return m ? parseFloat(m[1] + '.' + m[2].padEnd(2, '0')) : null; };

export const USES = { cook: '🍳 Для готовки', tasty: '😋 Вкусняшки', ready: '🥪 Готовое к еде', drink: '🥤 Напитки', fresh: '🥬 Свежее', other: 'Другое' };
const USE_RULES = [
  ['drink', /saft|wasser|cola|limo|sprudel|\bbier|\bwein|sekt|kaffee|\btee\b|energy|smoothie|schorle|likör|whisk|vodka|\bgin\b/i],
  ['tasty', /schoko|keks|kuchen|riegel|gummi|chips|snack|\beis\b|bonbon|praline|waffel|marzipan|popcorn|kitkat|lion|milka|haribo|nutella|lebkuchen|stollen|plätzchen|gebäck|torte|dessert|pudding|nuss|nüsse|trockenfrüchte|honig|konfekt/i],
  ['ready', /pizza|fertig|suppe|burger|nugget|schinken|wurst|salami|aufschnitt|aufstrich|käse|brötchen|\bbrot\b|sandwich|döner|lasagne|salat|\bdip\b|joghurt|skyr|quark|tiefkühl|youcook|frosta|baguette|croissant/i],
  ['cook', /mehl|zucker|\böl\b|essig|reis|nudel|pasta|sauce|soße|gewürz|hack|fleisch|schnitzel|kotelett|filet|steak|entrec|butter|sahne|rahm|\bei(er)?\b|tomate|passiert|mais|bohnen|linsen|zwiebel|kartoffel|brühe|fond|koch|back|hefe|füllung|milch|gulasch|geflügel|hähnchen|lachs|fisch/i],
  ['fresh', /obst|gemüse|birne|apfel|äpfel|banane|gurke|zucchini|paprika|möhre|karotte|beere|traube|orange|zitrone|kiwi|avocado|pilz/i]
];
const CAT_USE = { fleisch: 'cook', wurst: 'ready', kaese: 'ready', milch: 'cook', gemuese: 'fresh', obst: 'fresh', brot: 'ready', getraenke: 'drink', schokolade: 'tasty', tiefkuehlkost: 'ready', kaffee: 'drink' };
export const classifyUse = (name, brand, cat) => {
  const t = `${name} ${brand}`;
  for (const [u, re] of USE_RULES) if (re.test(t)) return u;
  return CAT_USE[cat] || 'other';
};

// Разбор HTML страницы категории: каждое предложение — <img alt="Название von Бренд im aktuellen Lidl Prospekt für 1,89 €">
export function parseOffers(html, storeKey) {
  const imgRe = /<img\b[^>]*?\balt="([^"]* im aktuellen [^"]* Prospekt für [^"]*)"[^>]*>/gi;
  const hits = []; let m;
  while ((m = imgRe.exec(html))) hits.push({ alt: decode(m[1]), tag: m[0], end: imgRe.lastIndex, start: m.index });
  const out = [];
  hits.forEach((h, i) => {
    const mm = h.alt.match(/^(.*?)\s+im aktuellen\s+(.+?)\s+Prospekt für\s+(.+)$/);
    if (!mm || !STORES[storeKey].match.test(mm[2])) return;
    const head = mm[1].trim();
    const price = toPrice(mm[3]);
    if (!price) return;
    let name = head, brand = '';
    const k = head.lastIndexOf(' von ');
    if (k > -1) { name = head.slice(0, k); brand = head.slice(k + 5); } else name = head.replace(/ von$/, '');
    const seg = strip(html.slice(h.end, hits[i + 1] ? hits[i + 1].start : h.end + 600)).slice(0, 400);
    const euros = [...seg.matchAll(/(\d+,\d{2})\s*€/g)].map(x => toPrice(x[1]));
    const old = euros.length > 1 && euros[1] > price ? euros[1] : null;
    const unit = (seg.match(/(?:1\s?(?:kg|l|g|ml|m)|kg-Preis|l-Preis)\s*=\s*(?:ab\s*)?[\d.,/]+/i) || [''])[0];
    const um = unit.match(/(kg|l)\b\D*=\s*(?:ab\s*)?(\d+(?:\.\d+)?)/i);
    const imgUrl = ((h.tag.match(/\bdata-src="([^"]+)"/) || h.tag.match(/\bsrc="([^"]+)"/) || [])[1] || '').replace(/&amp;/g, '&');
    const before = html.slice(Math.max(0, h.start - 500), h.start);
    const ai = before.lastIndexOf('<a '), ac = before.lastIndexOf('</a>');
    let link = '';
    if (ai > ac) { const hm = before.slice(ai).match(/href="([^"]+)"/); if (hm) link = new URL(decode(hm[1]), 'https://www.meinprospekt.de').href; }
    out.push({ store: storeKey, name: name.trim(), brand: brand.trim(), price, old,
      discount: old ? Math.round((1 - price / old) * 100) : null, unit,
      unitPrice: um ? parseFloat(um[2]) : null, unitBase: um ? um[1].toLowerCase() : null,
      img: imgUrl, link });
  });
  return out;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function get(url) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PersonalDealsBot/1.0)', 'Accept-Language': 'de-DE,de;q=0.9' } });
    if (!r.ok) { console.log('  HTTP', r.status, url); return null; }
    return await r.text();
  } catch (e) { console.log('  ошибка', e.name, url); return null; } finally { clearTimeout(t); }
}

function weekRange(d = new Date()) {
  const mon = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7)));
  const sat = new Date(mon.getTime() + 5 * 864e5);
  const f = (x) => x.toISOString().slice(0, 10);
  return { from: f(mon), to: f(sat) };
}

async function main() {
  let prev = { deals: [] };
  try { prev = JSON.parse(await readFile('deals.json', 'utf8')); } catch {}
  const deals = [], stores = {};
  for (const [key, st] of Object.entries(STORES)) {
    if (st.itemized === false) {
      stores[key] = { name: st.name, count: 0, note: st.note, ...(st.link ? { link: st.link } : {}) };
      console.log(st.name, '→ нет поштучных данных (только листовка)');
      continue;
    }
    const seen = new Set(); let ok = 0;
    const MAX = Number(process.env.MAX_PAGES || 40);
    const queue = CATS.map(c => c[0]), done = new Set();
    for (let qi = 0; qi < queue.length && done.size < MAX; qi++) {
      const cat = queue[qi];
      if (done.has(cat)) continue;
      done.add(cat);
      const html = await get(`https://www.meinprospekt.de/angebote/${cat}/${st.slug}`);
      await sleep(1200);
      if (!html) continue;
      ok++;
      // находим ссылки на другие категории этого же магазина
      for (const mm of html.matchAll(new RegExp(`/angebote/([a-z0-9äöüß-]+)/${st.slug}`, 'gi'))) {
        const c2 = mm[1].toLowerCase();
        if (!done.has(c2) && !queue.includes(c2)) queue.push(c2);
      }
      for (const d of parseOffers(html, key)) {
        const id = `${key}|${d.name}|${d.brand}|${d.price}`;
        if (seen.has(id)) continue;
        seen.add(id);
        const page = `https://www.meinprospekt.de/angebote/${cat}/${st.slug}`;
        deals.push({ id, ...d, link: d.link || page, use: classifyUse(d.name, d.brand, cat), cat });
      }
    }
    const count = deals.filter(d => d.store === key).length;
    stores[key] = { name: st.name, count, pages: done.size, pagesOk: ok, ...(st.note ? { note: st.note } : {}) };
    if (!count) {
      // источник не ответил — оставляем прошлые данные и помечаем их
      const old = (prev.deals || []).filter(d => d.store === key).map(d => ({ ...d, stale: true }));
      deals.push(...old);
      stores[key].count = old.length; stores[key].stale = true;
    }
    console.log(st.name, '→', stores[key].count, 'предложений', stores[key].stale ? '(старые данные)' : '');
  }
  if (!deals.length) { console.error('Ничего не собрано — deals.json не тронут.'); process.exit(1); }
  await writeFile('deals.json', JSON.stringify({
    updatedAt: new Date().toISOString(), week: weekRange(), source: 'meinprospekt.de',
    cats: Object.fromEntries(CATS), uses: USES, stores, deals
  }, null, 1));
  console.log('Готово: deals.json,', deals.length, 'предложений');
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main();
