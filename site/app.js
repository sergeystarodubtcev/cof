/* Зерно — поиск и сравнение specialty-кофе. Без сборки и зависимостей: читает data/catalog.json. */
(() => {
"use strict";

// ═════════════════════════ утилиты ═════════════════════════
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const rub = n => n == null ? "—" : Math.round(n).toLocaleString("ru-RU") + " ₽";
const fmtW = w => !w ? "" : w >= 1000 ? (w / 1000).toLocaleString("ru-RU") + " кг" : w + " г";
const plural = (n, a, b, c) => { const m = n % 10, h = n % 100; return m === 1 && h !== 11 ? a : m >= 2 && m <= 4 && (h < 12 || h > 14) ? b : c; };
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const fold = s => String(s || "").toLowerCase().replace(/ё/g, "е").normalize("NFKC");
const TR = { а:"a",б:"b",в:"v",г:"g",д:"d",е:"e",ж:"zh",з:"z",и:"i",й:"i",к:"k",л:"l",м:"m",н:"n",о:"o",п:"p",р:"r",с:"s",т:"t",у:"u",ф:"f",х:"h",ц:"c",ч:"ch",ш:"sh",щ:"sh",ъ:"",ы:"y",ь:"",э:"e",ю:"yu",я:"ya" };
// та же фонетическая свёртка, что и в scraper/match.py → «yirgacheffe» == «иргачеффе»
function latin(s) {
  s = fold(s).replace(/[а-я]/g, c => TR[c] ?? c).replace(/[^a-z0-9 ]+/g, " ").replace(/\by(?=[aeiou])/g, "");
  for (const [a, b] of [["ff","f"],["ch","c"],["sh","s"],["kh","h"],["ph","f"],["w","v"],["j","dz"],["q","k"],["x","ks"],["ee","i"],["y","i"],["ll","l"],["tt","t"],["rr","r"],["ss","s"],["nn","n"]]) s = s.split(a).join(b);
  return s.replace(/\s+/g, " ").trim();
}
const SYN = {
  washed: "мытая", мытый: "мытая", natural: "натуральная", натурал: "натуральная", honey: "хани", мед: "хани",
  anaerobic: "анаэробная", анаэроб: "анаэробная", gesha: "гейша", geisha: "гейша", decaf: "декаф", "без кофеина": "декаф",
  filter: "фильтр", espresso: "эспрессо", omni: "омни", berry: "ягоды", chocolate: "шоколад", citrus: "цитрус", floral: "цветы",
  kenya: "кения", ethiopia: "эфиопия", colombia: "колумбия", brazil: "бразилия", guatemala: "гватемала", rwanda: "руанда",
};
const ROAST = { filter: "Фильтр", espresso: "Эспрессо", omni: "Омни" };
const FLAVOR_COLOR = {
  "ягоды": "#c2335a", "цитрус": "#e0a400", "косточковые": "#ee8a4a", "тропики": "#f2b134", "цветы": "#a77bd6",
  "шоколад": "#6b3d24", "орехи": "#a77a4a", "карамель": "#c98a2b", "сухофрукты": "#8c4a5c", "специи": "#b4532a",
  "вино/ферментация": "#7c2240", "яблоко/груша": "#7aa33b",
};
const PALETTE = ["#c2581e", "#7a3b1a", "#2f8a57", "#2c6f93", "#7a4fa0", "#b07d1a", "#a63a4b", "#4f6b2a", "#5c4b8a", "#1f7a74"];
const colorOf = s => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return PALETTE[h % PALETTE.length]; };
// «THE WELDER CATHERINE» → «Welder», «СОК — студия обжарки» → «СОК»
const shortName = r => r.short || (r.short = String(r.name).split(/\s[—–-]\s|\(/)[0].replace(/^the\s+/i, "").split(/\s+/)[0]);
// названия КАПСОМ → обычный регистр
const nice = s => { const L = String(s).replace(/[^\p{L}]/gu, ""); if (L.length < 4 || L !== L.toUpperCase()) return s;
  return String(s).toLowerCase().replace(/(^|[\s«"(\-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase()).replace(/\b(Аа|Ав|Ab|Aa|Пб|Sl)\b/g, x => x.toUpperCase()); };
const initials = s => String(s).replace(/[^\p{L}\p{N} ]/gu, "").split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join("").toUpperCase();
const I = {
  chev: '<svg class="chev" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>',
  cmp: '<svg viewBox="0 0 24 24"><path d="M7 4v16M17 4v16M3 8h8M13 16h8"/></svg>',
  sim: '<svg viewBox="0 0 24 24"><circle cx="9" cy="9" r="5"/><circle cx="15" cy="15" r="5"/></svg>',
  filter: '<svg viewBox="0 0 24 24"><path d="M4 6h16M7 12h10M10 18h4"/></svg>',
  ext: '<svg viewBox="0 0 24 24" style="width:15px;height:15px"><path d="M7 17 17 7M9 7h8v8"/></svg>',
  back: '<svg viewBox="0 0 24 24" style="width:15px;height:15px"><path d="M15 6l-6 6 6 6"/></svg>',
};

// ═════════════════ доставка: оценка сроков ═════════════════
const CITY_ZONE = {
  "Москва": "MSK", "Санкт-Петербург": "SPB", "Тамбов": "CEN", "Воронеж": "CEN", "Ярославль": "CEN", "Тула": "CEN", "Нижний Новгород": "VOL",
  "Казань": "VOL", "Самара": "VOL", "Пермь": "VOL", "Ижевск": "VOL", "Уфа": "VOL", "Саратов": "VOL",
  "Екатеринбург": "URL", "Челябинск": "URL", "Тюмень": "URL", "Омск": "SIB", "Новосибирск": "SIB", "Томск": "SIB", "Красноярск": "SIB", "Барнаул": "SIB", "Иркутск": "SIB",
  "Краснодар": "SOU", "Ростов-на-Дону": "SOU", "Сочи": "SOU", "Волгоград": "SOU", "Калининград": "KGD", "Мурманск": "NW", "Архангельск": "NW",
  "Владивосток": "FE", "Хабаровск": "FE", "Якутск": "FE",
};
const ZONES = ["MSK", "SPB", "CEN", "VOL", "URL", "SIB", "SOU", "NW", "KGD", "FE"];
const T = [ // ориентировочные сроки СДЭК/Почты, рабочие дни [min,max]
  [[1,1],[1,2],[1,3],[2,3],[2,4],[3,5],[2,4],[3,5],[3,5],[6,10]],
  [[1,2],[1,1],[2,3],[2,4],[3,5],[4,6],[3,5],[2,4],[3,5],[7,11]],
  [[1,3],[2,3],[1,2],[2,4],[3,5],[4,6],[2,4],[3,6],[4,6],[7,11]],
  [[2,3],[2,4],[2,4],[1,3],[2,3],[3,5],[3,5],[4,6],[4,7],[6,10]],
  [[2,4],[3,5],[3,5],[2,3],[1,2],[2,4],[3,6],[4,7],[5,7],[5,9]],
  [[3,5],[4,6],[4,6],[3,5],[2,4],[1,3],[4,7],[5,8],[5,8],[4,7]],
];
function transit(from, to) {
  const a = ZONES.indexOf(CITY_ZONE[from] || "CEN"), b = ZONES.indexOf(CITY_ZONE[to] || "CEN");
  if (a === b) return [1, 2];
  return T[a]?.[b] || T[b]?.[a] || [3, 7];
}
function deliveryEst(r, city) {
  if (!r || !city) return null;
  const lag = r.roast_lag ?? 1, [lo, hi] = transit(r.city, city);
  return { lo: lo + lag, hi: hi + lag + (lag ? 1 : 0), same: r.city === city };
}
const fmtDlv = d => !d ? "—" : `${d.lo}–${d.hi} дн.${d.same ? " · курьер" : ""}`;

// ═════════════════════════ данные ═════════════════════════
let DB = null, R = {}, LOTS = {}, BYID = {};
const state = {
  f: {}, sort: store.get("sort", "rel"), view: store.get("view", "lots"), cmp: new Set(store.get("cmp", [])),
  city: store.get("city", "Москва"), q: "", open: null, popQ: "",
};
const avail = p => p.available !== false;
const availRank = p => p.available === false ? 0 : p.available == null ? 1 : 2;
const packs = p => [...(p.variants || [])].filter(v => v.p).sort((a, b) => (a.w || 1e9) - (b.w || 1e9));
const minPack = p => packs(p)[0];

function prepare(cat) {
  DB = cat;
  R = Object.fromEntries(cat.roasters.map(r => [r.id, r]));
  LOTS = {}; BYID = {};
  for (const p of cat.products) {
    const r = R[p.roaster] || { id: p.roaster, name: p.roaster };
    p._r = r; BYID[p.id] = p;
    const txt = [p.name, r.name, r.city, p.country, p.region, p.process, ...(p.varieties || []), ...(p.flavors || []), p.notes,
      ROAST[p.roast], p.roast, p.is_decaf ? "декаф" : "", p.is_blend ? "смесь бленд" : ""].filter(Boolean).join(" ");
    p._f = fold(txt + " " + (p.description || "").slice(0, 500));
    p._l = latin(txt);
    p._n = fold(p.name) + " " + latin(p.name);
    p._pf = p.process && ["Анаэробная", "Карбоническая мацерация", "Термошок", "Ферментация"].includes(p.process) ? "exp" : p.process;
    (LOTS[p.lot] ||= []).push(p);
  }
  for (const ps of Object.values(LOTS)) {
    ps.sort((a, b) => availRank(b) - availRank(a) || (a.price_100g ?? 1e9) - (b.price_100g ?? 1e9));
    const n = new Set(ps.map(p => p.roaster)).size;
    for (const p of ps) p._multi = n;
  }
}

// ═════════════════════════ поиск ═════════════════════════
function qTokens(q) {
  return fold(q).split(/[\s,]+/).filter(t => t.length > 1).map(t => {
    const syn = SYN[t] || Object.entries(SYN).find(([k]) => k.length > 3 && t.length > 3 && k.startsWith(t))?.[1];
    return { raw: t, lat: latin(t), syn: syn && fold(syn) };
  });
}
function score(p, toks) {
  let s = 0;
  for (const t of toks) {
    const hit = p._f.includes(t.raw) || (t.lat.length > 2 && p._l.includes(t.lat)) || (t.syn && (p._f.includes(t.syn) || p._l.includes(latin(t.syn))));
    if (!hit) return 0;
    s += p._n.includes(t.raw) || (t.lat && p._n.includes(t.lat)) ? 3 : 1;
  }
  return s;
}

// ═════════════════════ похожесть лотов ═════════════════════
// Совпадение происхождения, обработки, сорта и вкуса → 0…1
function similarity(a, b) {
  let s = 0, m = 0;
  const add = (w, hit) => { m += w; if (hit) s += w * (hit === true ? 1 : hit); };
  add(3, a.country && a.country === b.country);
  if (a.region) add(2.5, a.region === b.region);
  if (a._pf) add(2.5, a._pf === b._pf);
  const va = a.varieties || [], vb = b.varieties || [];
  if (va.length) add(2, va.some(v => vb.includes(v)));
  const fa = a.flavors || [], fb = b.flavors || [];
  if (fa.length) { const inter = fa.filter(f => fb.includes(f)).length, uni = new Set([...fa, ...fb]).size; add(4, uni ? inter / uni : 0); }
  if (a.roast) add(1, a.roast === b.roast || b.roast === "omni" || a.roast === "omni");
  if (a.altitude && b.altitude) add(1, a.altitude[0] <= b.altitude[1] && b.altitude[0] <= a.altitude[1]);
  let r = m ? s / m : 0;
  if (a.is_blend !== b.is_blend) r *= .6;
  if (a.is_decaf !== b.is_decaf) r *= .5;
  return r;
}
function similarTo(p, n = 60) {
  const seen = new Set([p.lot]), out = [];
  for (const q of DB.products) {
    if (q.gone || seen.has(q.lot) && q.lot === p.lot) continue;
    const s = similarity(p, q);
    if (s > .25) out.push([s, q]);
  }
  out.sort((x, y) => y[0] - x[0] || availRank(y[1]) - availRank(x[1]));
  const lots = new Set(), res = [];
  for (const [s, q] of out) { if (lots.has(q.lot)) continue; lots.add(q.lot); res.push([s, q]); if (res.length >= n) break; }
  return res;
}

// ═════════════════════════ фильтры ═════════════════════════
const FACETS = [
  { k: "country", t: "Страна", get: p => p.country, search: true },
  { k: "region", t: "Регион", get: p => p.region, search: true },
  { k: "process", t: "Обработка", get: p => p.process },
  { k: "variety", t: "Сорт", get: p => p.varieties, search: true },
  { k: "flavor", t: "Вкус", get: p => p.flavors },
  { k: "roast", t: "Обжарка", get: p => ROAST[p.roast] },
  { k: "roaster", t: "Обжарщик", get: p => p._r.name, search: true },
  { k: "weight", t: "Фасовка", get: p => packs(p).map(v => fmtW(v.w)).filter(Boolean), order: v => parseFloat(v.replace(",", ".")) * (v.includes("кг") ? 1000 : 1) },
];
const TOGGLES = [
  { k: "instock", t: "Только в наличии", test: avail },
  { k: "multi", t: "Есть у нескольких обжарщиков", test: p => p._multi > 1 },
  { k: "new", t: "Новинки за 14 дней", test: p => p.is_new },
  { k: "noblend", t: "Без смесей", test: p => !p.is_blend },
  { k: "nodecaf", t: "Без декафа", test: p => !p.is_decaf },
  { k: "fast", t: "Доставка до 3 дней", test: p => (deliveryEst(p._r, state.city)?.hi ?? 99) <= 3 },
];
const QUICK = [
  { t: "У нескольких обжарщиков", i: "⇄", tg: "multi" },
  { t: "Новинки", i: "✦", tg: "new" },
  { t: "Гейша", k: "variety", v: "Гейша" },
  { t: "Анаэробная", k: "process", v: "Анаэробная" },
  { t: "Эфиопия", k: "country", v: "Эфиопия" },
  { t: "Кения", k: "country", v: "Кения" },
  { t: "Колумбия", k: "country", v: "Колумбия" },
  { t: "Для фильтра", k: "roast", v: "Фильтр" },
  { t: "Для эспрессо", k: "roast", v: "Эспрессо" },
  { t: "Ягодные", k: "flavor", v: "ягоды" },
  { t: "Цветочные", k: "flavor", v: "цветы" },
  { t: "Шоколадные", k: "flavor", v: "шоколад" },
  { t: "Пачка до 1 000 ₽", price: [null, 1000] },
];
const vals = (fc, p) => { const v = fc.get(p); return Array.isArray(v) ? v : v ? [v] : []; };

function base() {
  let list = DB.products.filter(p => !p.gone);
  const toks = qTokens(state.q);
  if (toks.length) { for (const p of list) p._s = score(p, toks); list = list.filter(p => p._s > 0); }
  else for (const p of list) p._s = 0;
  return list;
}
function applyFilters(list, skip) {
  const f = state.f;
  return list.filter(p => {
    for (const fc of FACETS) {
      if (fc.k === skip || !f[fc.k]?.length) continue;
      const v = vals(fc, p);
      if (!f[fc.k].some(x => v.includes(x))) return false;
    }
    for (const tg of TOGGLES) if (f[tg.k] && !tg.test(p)) return false;
    if (skip !== "price" && (f.pmin || f.pmax)) {
      const ok = packs(p).some(v => (!f.pmin || v.p >= +f.pmin) && (!f.pmax || v.p <= +f.pmax));
      if (!ok) return false;
    }
    return true;
  });
}
function sortList(list) {
  const mp = p => minPack(p)?.p ?? 1e9;
  const by = {
    rel: (a, b) => (b._s || 0) - (a._s || 0) || (b._multi - a._multi) || (availRank(b) - availRank(a)) || (b.is_new - a.is_new),
    cheap: (a, b) => mp(a) - mp(b),
    p100: (a, b) => (a.price_100g ?? 1e9) - (b.price_100g ?? 1e9),
    multi: (a, b) => b._multi - a._multi || (a.price_100g ?? 1e9) - (b.price_100g ?? 1e9),
    new: (a, b) => b.first_seen.localeCompare(a.first_seen),
    alt: (a, b) => (b.altitude?.[1] ?? 0) - (a.altitude?.[1] ?? 0),
  }[state.sort] || (() => 0);
  return [...list].sort(by);
}
const SORTS = [["rel", "Сначала релевантные"], ["cheap", "Дешевле пачка"], ["p100", "Выгоднее за грамм"], ["multi", "У большего числа обжарщиков"], ["new", "Сначала новые"], ["alt", "Выше высота"]];
const nSel = () => FACETS.reduce((n, fc) => n + (state.f[fc.k]?.length || 0), 0) + TOGGLES.filter(t => state.f[t.k]).length + (state.f.pmin || state.f.pmax ? 1 : 0);

// ═════════════════════ куски разметки ═════════════════════
function cover(p) {
  if (p.image) return `<img src="${esc(p.image)}" alt="${esc(p.name)}" loading="lazy" decoding="async">`;
  const c = colorOf(p.country || p.name);
  return `<div class="ph" style="background:linear-gradient(140deg,${c},${colorOf((p.region || "") + p.roaster)})"><div>${esc(p.country || (p.is_blend ? "Смесь" : "Кофе"))}${p.region ? `<small>${esc(p.region)}</small>` : ""}</div></div>`;
}
const avatar = r => `<span class="av" title="${esc(r.name)}" style="background:${colorOf(r.id)}">${esc(initials(r.name))}</span>`;
const origin = p => [p.country, p.region, p.process].filter(Boolean).join(" · ") || (p.is_blend ? "Смесь" : "");
function noteChips(p, n = 3) {
  const out = (p.flavors || []).slice(0, n).map(f => `<span class="note"><i style="background:${FLAVOR_COLOR[f] || "#999"}"></i>${esc(f)}</span>`);
  if (!out.length && p.roast) out.push(`<span class="note">${ROAST[p.roast]}</span>`);
  return out.join("");
}
function packList(p, max = 3) {
  const ps = packs(p);
  if (!ps.length) return "";
  const unk = p.available == null;
  return ps.slice(0, max).map((v, i) => `<div class="pack ${i ? "" : "first"} ${v.a === false && !unk ? "na" : ""}"><b>${rub(v.p)}</b><span>${v.w ? fmtW(v.w) : "фасовка не указана"}</span></div>`).join("")
    + (ps.length > max ? `<div class="range-note">ещё ${ps.length - max} ${plural(ps.length - max, "фасовка", "фасовки", "фасовок")}</div>` : "");
}
const actions = p => `<div class="c-actions">
  <button class="c-act ${state.cmp.has(p.id) ? "on" : ""}" data-cmp="${p.id}" title="Добавить в сравнение" aria-label="Сравнить">${I.cmp}</button>
  <a class="c-act" href="#/similar/${p.id}" title="Найти похожие" aria-label="Похожие">${I.sim}</a></div>`;

function lotCard(ps, simScore) {
  const head = ps.find(p => p.image && avail(p)) || ps.find(p => p.image) || ps[0];
  const live = ps.filter(avail);
  const rs = [...new Map(ps.map(p => [p.roaster, p._r])).values()];
  // название: где есть страна/регион, по-русски, покороче; безликое «Кофе в зернах» — в последнюю очередь
  const rank = n => { const f = fold(n); return (head.country && f.includes(fold(head.country).slice(0, 5)) ? 0 : 2) + (head.region && f.includes(fold(head.region).slice(0, 4)) ? -1 : 0) + (/[а-я]/i.test(n) ? 0 : 1) + (/^кофе в зерн/i.test(n) ? 5 : 0); };
  const name = nice(ps.map(p => p.name).sort((a, b) => rank(a) - rank(b) || a.length - b.length)[0]);
  let price;
  if (rs.length > 1) {
    // у нескольких обжарщиков: самая дешёвая пачка каждого
    const rows = rs.map(r => { const p = ps.filter(x => x.roaster === r.id).sort((a, b) => availRank(b) - availRank(a))[0]; return [r, p, minPack(p)]; })
      .filter(x => x[2]).sort((a, b) => a[2].p - b[2].p).slice(0, 3);
    price = rows.map(([r, p, v], i) => `<div class="pack ${i ? "" : "first"} ${p.available === false ? "na" : ""}"><b>${rub(v.p)}</b><span>${v.w ? fmtW(v.w) + " · " : ""}${esc(shortName(r))}</span></div>`).join("");
  } else price = packList(head);
  return `<article class="card">
    <a class="cover" href="#/lot/${head.lot}">${cover(head)}
      <div class="badges">${rs.length > 1 ? `<span class="badge multi">${rs.length} ${plural(rs.length, "обжарщик", "обжарщика", "обжарщиков")}</span>` : ""}${ps.some(p => p.is_new) ? `<span class="badge new">Новинка</span>` : ""}${!live.length ? `<span class="badge out">Нет в наличии</span>` : ""}</div></a>
    ${actions(head)}
    <div class="body">
      <div class="who"><span class="avs">${rs.slice(0, 4).map(avatar).join("")}</span><span>${rs.length === 1 ? esc(rs[0].name) : rs.map(r => esc(shortName(r))).join(", ")}</span></div>
      <h3><a href="#/lot/${head.lot}">${esc(name)}</a></h3>
      <div class="origin">${esc(origin(head))}</div>
      <div class="notes">${noteChips(head)}</div>
      ${simScore != null ? `<div class="sim"><span>Совпадение</span><span class="sim-bar"><i style="width:${Math.round(simScore * 100)}%"></i></span><b>${Math.round(simScore * 100)}%</b></div>` : ""}
      <div class="packs">${price}</div>
    </div></article>`;
}
function itemCard(p) {
  return `<article class="card">
    <a class="cover" href="#/lot/${p.lot}/${p.id}">${cover(p)}
      <div class="badges">${p._multi > 1 ? `<span class="badge multi">ещё у ${p._multi - 1}</span>` : ""}${p.is_new ? `<span class="badge new">Новинка</span>` : ""}${p.available === false ? `<span class="badge out">Нет в наличии</span>` : ""}</div></a>
    ${actions(p)}
    <div class="body">
      <div class="who">${avatar(p._r)}<span>${esc(p._r.name)}</span></div>
      <h3><a href="#/lot/${p.lot}/${p.id}">${esc(nice(p.name))}</a></h3>
      <div class="origin">${esc(origin(p))}</div>
      <div class="notes">${noteChips(p)}</div>
      <div class="packs">${packList(p)}</div>
    </div></article>`;
}

// ═════════════════════ каталог ═════════════════════
function facetCounts(fc, b) {
  const counts = new Map();
  for (const p of applyFilters(b, fc.k)) for (const v of new Set(vals(fc, p))) counts.set(v, (counts.get(v) || 0) + 1);
  for (const s of state.f[fc.k] || []) if (!counts.has(s)) counts.set(s, 0);
  const sel = state.f[fc.k] || [];
  return [...counts].sort((a, b) => fc.order ? fc.order(a[0]) - fc.order(b[0]) : sel.includes(b[0]) - sel.includes(a[0]) || b[1] - a[1] || a[0].localeCompare(b[0]));
}
function optList(fc, b, q = "") {
  const fq = fold(q), lq = latin(q);
  const rows = facetCounts(fc, b).filter(([v]) => !q || fold(v).includes(fq) || latin(v).includes(lq));
  if (!rows.length) return `<div class="opt zero">Ничего не найдено</div>`;
  const sel = state.f[fc.k] || [];
  return rows.map(([v, n]) => `<label class="opt ${n ? "" : "zero"}"><input type="checkbox" data-f="${fc.k}" value="${esc(v)}" ${sel.includes(v) ? "checked" : ""}><span>${fc.k === "flavor" ? `<i style="display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:7px;background:${FLAVOR_COLOR[v] || "#999"}"></i>` : ""}${esc(v)}</span><small>${n}</small></label>`).join("");
}
function popHTML(key, b) {
  if (key === "price") return `<div class="pop" data-pop="price"><div class="range">
      <label>Пачка от, ₽<input type="number" inputmode="numeric" id="pmin" value="${esc(state.f.pmin || "")}" placeholder="0"></label>
      <label>до, ₽<input type="number" inputmode="numeric" id="pmax" value="${esc(state.f.pmax || "")}" placeholder="∞"></label></div>
      <div class="presets">${[[null, 700], [null, 1000], [1000, 2000], [2000, null]].map(([a, z]) => `<button class="q-chip" data-preset="${a ?? ""}-${z ?? ""}">${a ? (z ? `${a}–${z} ₽` : `от ${a} ₽`) : `до ${z} ₽`}</button>`).join("")}</div></div>`;
  if (key === "more") return `<div class="pop" data-pop="more"><div class="pop-l">${TOGGLES.map(tg => `<label class="tg">${tg.t}<input type="checkbox" data-tg="${tg.k}" ${state.f[tg.k] ? "checked" : ""}></label>`).join("")}</div></div>`;
  const fc = FACETS.find(f => f.k === key);
  return `<div class="pop" data-pop="${key}">${fc.search ? `<div class="pop-h"><input type="search" id="popq" placeholder="Найти: ${fc.t.toLowerCase()}" value="${esc(state.popQ)}" autocomplete="off"></div>` : ""}
    <div class="pop-l" id="popl">${optList(fc, b, state.popQ)}</div>
    <div class="pop-f"><button class="btn link" data-clear="${key}">Сбросить</button><button class="btn sm" data-close>Готово</button></div></div>`;
}
function fbarHTML(b) {
  const btn = (k, t, n) => `<div style="position:relative" class="fb-d"><button class="fbtn ${n ? "set" : ""}" data-open="${k}" aria-expanded="${state.open === k}">${t}${n ? `<span class="n">${n}</span>` : ""}${I.chev}</button>${state.open === k ? popHTML(k, b) : ""}</div>`;
  const nt = TOGGLES.filter(t => state.f[t.k]).length;
  const total = nSel();
  return `<button class="fbtn all ${total ? "set" : ""}" data-sheet>${I.filter}Фильтры${total ? `<span class="n">${total}</span>` : ""}</button>
    ${FACETS.map(fc => btn(fc.k, fc.t, state.f[fc.k]?.length || 0)).join("")}
    ${btn("price", "Цена", state.f.pmin || state.f.pmax ? 1 : 0)}
    ${btn("more", "Ещё", nt)}`;
}
function activeHTML() {
  const out = [];
  for (const fc of FACETS) for (const v of state.f[fc.k] || []) out.push(`<span class="tag-x"><small>${fc.t}:</small>${esc(v)}<button data-unf="${fc.k}" data-v="${esc(v)}" aria-label="Убрать">✕</button></span>`);
  for (const tg of TOGGLES) if (state.f[tg.k]) out.push(`<span class="tag-x">${tg.t}<button data-untg="${tg.k}" aria-label="Убрать">✕</button></span>`);
  if (state.f.pmin || state.f.pmax) out.push(`<span class="tag-x"><small>Пачка:</small>${state.f.pmin ? "от " + rub(+state.f.pmin) + " " : ""}${state.f.pmax ? "до " + rub(+state.f.pmax) : ""}<button data-clear="price" aria-label="Убрать">✕</button></span>`);
  if (state.q) out.unshift(`<span class="tag-x"><small>Поиск:</small>«${esc(state.q)}»<button data-clearq aria-label="Убрать">✕</button></span>`);
  return out.length ? out.join("") + `<button class="btn link" data-reset>Сбросить всё</button>` : "";
}
function quickHTML() {
  return QUICK.map((q, i) => {
    const on = q.tg ? !!state.f[q.tg] : q.price ? (+state.f.pmax === q.price[1] && !state.f.pmin) : (state.f[q.k] || []).includes(q.v);
    return `<button class="q-chip ${on ? "on" : ""}" data-quick="${i}">${q.i ? `<i>${q.i}</i>` : ""}${q.t}</button>`;
  }).join("");
}

function renderCatalog(mode) {
  const isNew = mode === "new";
  const live = DB.roasters.filter(r => r.count);
  const multi = new Set(DB.products.filter(p => p._multi > 1).map(p => p.lot)).size;
  $("#app").innerHTML = `
    ${isNew ? `<div class="hero"><div><h1>Новинки</h1><p>Лоты, которые появились у обжарщиков за последние 14 дней.</p></div></div>` :
      `<section class="hero"><div><h1>Один и тот же кофе — <span>у всех обжарщиков</span> рядом</h1>
        <p>Ищите по стране, ферме, сорту или вкусу, сравнивайте цены всех фасовок и находите похожие лоты.</p></div>
        <div class="kpis"><div class="kpi"><b class="num">${DB.products.filter(p => !p.gone && avail(p)).length}</b><span>позиций</span></div>
        <div class="kpi"><b class="num">${live.length}</b><span>${plural(live.length, "обжарщик", "обжарщика", "обжарщиков")}</span></div>
        <div class="kpi"><b class="num">${multi}</b><span>лотов у 2+</span></div></div></section>`}
    <div class="quick" id="quick">${quickHTML()}</div>
    <div class="fbar" id="fbar"></div>
    <div class="active" id="active"></div>
    <div id="results"></div>`;
  if (isNew) state.f.new = true;
  refresh();
}
function refresh(keepPop) {
  if (!$("#fbar")) return;
  const b = base();
  if (!keepPop) $("#fbar").innerHTML = fbarHTML(b);
  else { const l = $("#popl"); if (l && state.open) l.innerHTML = optList(FACETS.find(f => f.k === state.open), b, state.popQ); updateFbarCounts(); }
  $("#quick").innerHTML = quickHTML();
  $("#active").innerHTML = activeHTML();
  const list = sortList(applyFilters(b));
  let cards, n;
  if (state.view === "lots") {
    const m = new Map();
    for (const p of list) (m.get(p.lot) || m.set(p.lot, []).get(p.lot)).push(p);
    n = m.size; cards = [...m.values()].slice(0, state.limit || 120).map(ps => lotCard(ps));
  } else { n = list.length; cards = list.slice(0, state.limit || 120).map(itemCard); }
  const shown = cards.length;
  $("#results").innerHTML = `<div class="rhead"><div class="count"><b class="num">${n}</b> ${state.view === "lots" ? plural(n, "лот", "лота", "лотов") : plural(n, "позиция", "позиции", "позиций")}${state.q ? ` по запросу «${esc(state.q)}»` : ""}</div>
    <div class="seg" role="tablist"><button data-view="lots" class="${state.view === "lots" ? "on" : ""}" title="Один лот у разных обжарщиков — одной карточкой">Лоты</button><button data-view="items" class="${state.view === "items" ? "on" : ""}">Все позиции</button></div>
    <select class="sel" id="sort" aria-label="Сортировка">${SORTS.map(([v, t]) => `<option value="${v}" ${state.sort === v ? "selected" : ""}>${t}</option>`).join("")}</select></div>
    ${n ? `<div class="grid">${cards.join("")}</div>${n > shown ? `<div style="text-align:center;margin-top:22px"><button class="btn ghost" data-more>Показать ещё ${Math.min(120, n - shown)}</button></div>` : ""}`
      : `<div class="empty"><h2>Ничего не нашлось</h2>Уберите часть фильтров или переформулируйте запрос — можно по-русски или по-английски.<br><br><button class="btn" data-reset>Сбросить фильтры</button></div>`}`;
  filtersToHash();
}
function updateFbarCounts() {
  for (const fc of FACETS) {
    const b = $(`[data-open="${fc.k}"]`); if (!b) continue;
    const n = state.f[fc.k]?.length || 0;
    b.classList.toggle("set", !!n);
    b.querySelector(".n")?.remove();
    if (n) b.querySelector("svg").insertAdjacentHTML("beforebegin", `<span class="n">${n}</span>`);
  }
}

// ═════════════════════ страница лота ═════════════════════
function spark(h) {
  if (!h || h.length < 2) return "";
  const ys = h.map(x => x[1]), lo = Math.min(...ys), hi = Math.max(...ys), w = 54, ht = 16;
  const pts = ys.map((y, i) => `${(i / (ys.length - 1)) * w},${hi === lo ? ht / 2 : ht - ((y - lo) / (hi - lo)) * ht}`).join(" ");
  return `<svg class="spark" width="${w}" height="${ht}" viewBox="0 -2 ${w} ${ht + 4}" style="width:${w}px;height:${ht}px;stroke:${ys.at(-1) > ys[0] ? "var(--accent)" : "var(--ok)"}"><polyline points="${pts}"/><title>${h.map(x => x[0] + ": " + rub(x[1])).join("\n")}</title></svg>`;
}
const stock = p => p.gone ? `<span class="stock"><span class="dot no"></span>снят с продажи</span>` : p.available === false ? `<span class="stock"><span class="dot no"></span>нет в наличии</span>`
  : p.available == null ? `<span class="stock" title="Сайт не показывает наличие без выбора города"><span class="dot unk"></span>наличие уточняйте</span>` : `<span class="stock"><span class="dot"></span>в наличии</span>`;

function renderLot(lotId, focusId) {
  const ps = LOTS[lotId];
  if (!ps) return renderNotFound();
  const focus = BYID[focusId] && BYID[focusId].lot === lotId ? BYID[focusId] : ps.find(p => p.image && avail(p)) || ps[0];
  const imgs = ps.filter(p => p.image);
  // лучшая цена: по одинаковой фасовке, если она есть у всех; иначе — по цене за грамм
  const live = ps.filter(p => avail(p) && !p.gone && packs(p).length);
  const best = [...live].sort((a, b) => (a.price_100g ?? 1e9) - (b.price_100g ?? 1e9))[0];
  const cheapestPack = Math.min(...live.flatMap(p => packs(p).map(v => v.p)));
  const rows = [...ps].sort((a, b) => availRank(b) - availRank(a) || (minPack(a)?.p ?? 1e9) - (minPack(b)?.p ?? 1e9));
  const merged = k => [...new Set(ps.flatMap(p => [].concat(p[k] || [])))];
  const spec = (t, v) => v ? `<div class="spec"><span>${t}</span><b>${esc(v)}</b></div>` : "";
  const sims = similarTo(focus, 10).filter(([, q]) => q.lot !== lotId);
  const nR = new Set(ps.map(p => p.roaster)).size;
  const bestPack = best && minPack(best);
  const descSrc = [focus, ...ps].sort((a, b) => (b.description || "").length - (a.description || "").length)[0];

  $("#app").innerHTML = `
  <div class="crumbs"><a href="#/" data-back>${I.back} Каталог</a>${focus.country ? `<span>/</span><a href="#/?country=${encodeURIComponent(focus.country)}">${esc(focus.country)}</a>` : ""}${focus.region ? `<span>/</span><a href="#/?region=${encodeURIComponent(focus.region)}">${esc(focus.region)}</a>` : ""}</div>
  <section class="lot">
    <div class="lot-media"><div class="lot-img" id="lotImg">${cover(focus)}</div>
      ${imgs.length > 1 ? `<div class="thumbs">${imgs.map(p => `<button data-img="${esc(p.image)}" class="${p === focus ? "on" : ""}" title="${esc(p._r.name)}"><img src="${esc(p.image)}" alt=""></button>`).join("")}</div>` : ""}</div>
    <div>
      <div class="origin">${esc(origin(focus))}</div>
      <h1>${esc(nice(focus.name))}</h1>
      ${focus.notes ? `<p class="lead">${esc(focus.notes)}</p>` : ""}
      <div class="notes">${noteChips(focus, 8)}</div>
      <div class="specs">
        ${spec("Страна", focus.country)}${spec("Регион", focus.region)}${spec("Обработка", merged("process").join(", "))}
        ${spec("Сорт", merged("varieties").join(", "))}${spec("Высота", focus.altitude && `${focus.altitude[0]}${focus.altitude[1] !== focus.altitude[0] ? "–" + focus.altitude[1] : ""} м`)}
        ${spec("Обжарка", merged("roast").map(r => ROAST[r]).join(", "))}${spec("Оценка SCA", merged("score").join(" / "))}
        ${Object.entries(focus.specs || {}).filter(([k]) => /Ферма|Производитель|Станция|Кооператив|Урожай|Сбор/.test(k)).map(([k, v]) => spec(k, v)).join("")}
      </div>
      ${best ? `<div class="best"><div><small>${nR > 1 ? "Выгоднее всего" : "Цена"} · ${esc(best._r.name)}</small><b class="num">${rub(bestPack.p)}</b> <span style="opacity:.7">за ${fmtW(bestPack.w) || "пачку"}</span></div>
        <div><small>Доставка · ${esc(state.city)}</small><b style="font-size:18px">${fmtDlv(deliveryEst(best._r, state.city))}</b></div>
        <a class="btn" href="${esc(best.url)}" target="_blank" rel="noopener">Заказать ${I.ext}</a></div>`
      : `<div class="best">Сейчас нет в продаже. Лот вернётся в каталог автоматически, когда появится у обжарщика.</div>`}
    </div>
  </section>

  <div class="h2row"><h2>${ps.length} ${plural(ps.length, "предложение", "предложения", "предложений")}</h2><span>у ${nR} ${plural(nR, "обжарщика", "обжарщиков", "обжарщиков")} · все фасовки</span></div>
  <div class="offers">${rows.map(p => {
    const d = deliveryEst(p._r, state.city), unk = p.available == null;
    return `<div class="offer ${p === best && nR > 1 ? "top1" : ""}">
      <div class="o-who">${p.image ? `<img src="${esc(p.image)}" alt="">` : avatar(p._r)}<div style="min-width:0"><b>${esc(p._r.name)}</b><small>${esc(p._r.city)} · ${esc(nice(p.name))}</small>${stock(p)}</div></div>
      <div class="o-packs">${packs(p).map(v => `<span class="pk ${v.a === false && !unk ? "na" : ""} ${v.p === cheapestPack && nR > 1 ? "cheap" : ""}"><b class="num">${rub(v.p)}</b><span>${v.w ? fmtW(v.w) : "фасовка не указана"}</span></span>`).join("")}${spark(p.price_history)}</div>
      <div class="o-dlv"><b>${fmtDlv(d)}</b>${esc((p._r.delivery?.methods || []).join(", ") || "СДЭК, Почта")}${p._r.delivery?.free_from ? ` · бесплатно от ${rub(p._r.delivery.free_from)}` : ""}</div>
      <div class="o-act"><button class="c-act ${state.cmp.has(p.id) ? "on" : ""}" data-cmp="${p.id}" title="Сравнить">${I.cmp}</button><a class="btn ${p.available === false ? "ghost" : "accent"}" href="${esc(p.url)}" target="_blank" rel="noopener">${p.available === false ? "На сайт" : "Заказать"} ${I.ext}</a></div>
    </div>`;
  }).join("")}</div>
  ${descSrc && descSrc.description.length > 40 ? `<div class="h2row"><h2>Описание</h2><span>${esc(descSrc._r.name)}</span></div><div class="desc">${esc(descSrc.description)}</div>` : ""}
  ${sims.length ? `<div class="h2row"><h2>Похожие лоты</h2><span>по происхождению, обработке, сорту и вкусу</span><span class="sp"></span><a class="btn ghost sm" href="#/similar/${focus.id}">Все похожие</a></div>
    <div class="grid">${sims.slice(0, 8).map(([s, q]) => lotCard(LOTS[q.lot], s)).join("")}</div>` : ""}`;
}

// ═════════════════════ похожие ═════════════════════
function renderSimilar(id) {
  const p = BYID[id];
  if (!p) return renderNotFound();
  const only = store.get("simAvail", true);
  const sims = similarTo(p, 120).filter(([, q]) => !only || avail(q));
  $("#app").innerHTML = `
  <div class="crumbs"><a href="#/lot/${p.lot}/${p.id}" data-back>${I.back} Назад к лоту</a></div>
  <div class="ref">${p.image ? `<img src="${esc(p.image)}" alt="">` : ""}<div><div class="origin">Похожие на</div><h1>${esc(nice(p.name))}</h1><p>${esc(origin(p))}${(p.flavors || []).length ? " · " + esc(p.flavors.join(", ")) : ""}</p></div></div>
  <div class="h2row"><h2>${sims.length} ${plural(sims.length, "похожий лот", "похожих лота", "похожих лотов")}</h2><span>сортировка по совпадению</span><span class="sp"></span>
    <label class="tg" style="padding:0">Только в наличии <input type="checkbox" id="simAvail" ${only ? "checked" : ""}></label></div>
  ${sims.length ? `<div class="grid">${sims.map(([s, q]) => lotCard(LOTS[q.lot], s)).join("")}</div>` : `<div class="empty"><h2>Похожих не нашлось</h2>У этого лота мало данных о происхождении и вкусе.</div>`}`;
}

// ═════════════════════ сравнение ═════════════════════
function renderCompare() {
  const ps = [...state.cmp].map(id => BYID[id]).filter(Boolean);
  if (!ps.length) { $("#app").innerHTML = `<div class="empty"><h2>Сравнение пустое</h2>Нажмите ${I.cmp} на карточке кофе, чтобы добавить до 6 позиций.<br><br><a class="btn" href="#/">В каталог</a></div>`; return; }
  const p100 = ps.map(p => p.price_100g).filter(Boolean), minP = Math.min(...p100);
  const minD = Math.min(...ps.map(p => deliveryEst(p._r, state.city)?.hi ?? 99));
  const row = (t, f) => `<tr><th>${t}</th>${ps.map(p => `<td>${f(p)}</td>`).join("")}</tr>`;
  $("#app").innerHTML = `<div class="h2row" style="margin-top:6px"><h2>Сравнение</h2><span>${ps.length} из 6</span><span class="sp"></span><button class="btn ghost sm" data-cmpclear>Очистить</button></div>
  <div class="cmp-wrap"><table class="cmp">
    ${row("", p => `<button class="x" data-cmp="${p.id}" aria-label="Убрать">✕</button><a href="#/lot/${p.lot}/${p.id}">${p.image ? `<img src="${esc(p.image)}" alt="">` : `<div style="width:120px;height:120px;position:relative;border-radius:14px;overflow:hidden">${cover(p)}</div>`}</a>`)}
    ${row("Кофе", p => `<b>${esc(nice(p.name))}</b>`)}
    ${row("Обжарщик", p => `${esc(p._r.name)}<br><small style="color:var(--ink-3)">${esc(p._r.city)}</small>`)}
    ${row("Фасовки и цены", p => `<div class="o-packs">${packs(p).map(v => `<span class="pk"><b class="num">${rub(v.p)}</b><span>${fmtW(v.w) || "—"}</span></span>`).join("")}</div>`)}
    ${row("Цена за 100 г", p => p.price_100g ? `<span class="${p.price_100g === minP && ps.length > 1 ? "win" : ""}">${rub(p.price_100g)}</span>` : "—")}
    ${row("Доставка · " + esc(state.city), p => { const d = deliveryEst(p._r, state.city); return `<span class="${d?.hi === minD && ps.length > 1 ? "win" : ""}">${fmtDlv(d)}</span>`; })}
    ${row("Страна, регион", p => esc([p.country, p.region].filter(Boolean).join(", ") || "—"))}
    ${row("Обработка", p => esc(p.process || "—"))}
    ${row("Сорт", p => esc((p.varieties || []).join(", ") || "—"))}
    ${row("Высота", p => p.altitude ? `${p.altitude[0]}–${p.altitude[1]} м` : "—")}
    ${row("Обжарка", p => esc(ROAST[p.roast] || "—"))}
    ${row("Вкус", p => `<div class="notes">${noteChips(p, 6) || "—"}</div>${p.notes ? `<small style="color:var(--ink-2)">${esc(p.notes)}</small>` : ""}`)}
    ${row("Наличие", stock)}
    ${row("", p => `<a class="btn accent sm" href="${esc(p.url)}" target="_blank" rel="noopener">Заказать ${I.ext}</a>`)}
  </table></div>`;
}

// ═════════════════════ обжарщики ═════════════════════
function renderRoasters() {
  const rs = [...DB.roasters].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  $("#app").innerHTML = `<div class="hero"><div><h1>Обжарщики</h1><p>${rs.filter(r => r.count).length} с актуальным каталогом из ${rs.length}. Каталоги обновляются автоматически каждые 6 часов.</p></div></div>
  <div class="rgrid">${rs.map(r => {
    const d = deliveryEst(r, state.city);
    const st = r.ok ? `<span class="status"><span class="dot"></span>обновлено ${r.checked_at ? new Date(r.checked_at).toLocaleDateString("ru-RU", { day: "numeric", month: "long" }) : ""}</span>`
      : r.stale ? `<span class="status"><span class="dot unk"></span>сайт не ответил — данные прошлой выгрузки</span>` : `<span class="status"><span class="dot no"></span>каталог пока не получен</span>`;
    return `<article class="rcard"><header>${avatar(r)}<div><h3>${esc(r.name)}</h3><div class="sub">${esc(r.city)}</div></div></header>
      ${r.award ? `<div class="award">★ ${esc(r.award)}</div>` : ""}
      <div class="kv">Кофе в каталоге<b class="num">${r.count}</b></div>
      <div class="kv">Доставка · ${esc(state.city)}<b>${fmtDlv(d)}</b></div>
      ${r.roast ? `<div class="kv">Обжарка<b>${esc(r.roast)}</b></div>` : ""}
      ${r.delivery?.methods ? `<div class="kv">Способы<b>${esc(r.delivery.methods.join(", "))}</b></div>` : ""}
      ${r.delivery?.free_from ? `<div class="kv">Бесплатно от<b>${rub(r.delivery.free_from)}</b></div>` : ""}
      ${st}${r.stock_unknown ? `<span class="status"><span class="dot unk"></span>наличие на сайте видно только после выбора города</span>` : ""}
      <div class="actions">${r.count ? `<a class="btn sm" href="#/?roaster=${encodeURIComponent(r.name)}">Каталог</a>` : ""}<a class="btn ghost sm" href="${esc(r.site)}" target="_blank" rel="noopener">Сайт ${I.ext}</a></div></article>`;
  }).join("")}</div>`;
}
const renderNotFound = () => { $("#app").innerHTML = `<div class="empty"><h2>Лот не найден</h2>Возможно, он снят с продажи.<br><br><a class="btn" href="#/">В каталог</a></div>`; };

// ═════════════════════ шторка фильтров (телефон) ═════════════════════
function openSheet() {
  const b = base();
  const n = applyFilters(b).length;
  $("#sheet").innerHTML = `<div class="sheet-in" role="dialog" aria-label="Фильтры">
    <div class="sheet-h"><h3>Фильтры</h3><button class="btn link" data-reset>Сбросить</button></div>
    <div class="sheet-b">
      <div style="padding:6px 0">${TOGGLES.map(tg => `<label class="tg">${tg.t}<input type="checkbox" data-tg="${tg.k}" ${state.f[tg.k] ? "checked" : ""}></label>`).join("")}</div>
      <details ${state.f.pmin || state.f.pmax ? "open" : ""}><summary>Цена пачки${state.f.pmin || state.f.pmax ? "<small>●</small>" : ""}</summary><div class="pop" style="position:static;width:auto;box-shadow:none;border:0"><div class="range">
        <label>от, ₽<input type="number" inputmode="numeric" id="pmin" value="${esc(state.f.pmin || "")}"></label><label>до, ₽<input type="number" inputmode="numeric" id="pmax" value="${esc(state.f.pmax || "")}"></label></div></div></details>
      ${FACETS.map(fc => `<details><summary>${fc.t}${state.f[fc.k]?.length ? `<small>${state.f[fc.k].length}</small>` : ""}</summary><div>${optList(fc, b)}</div></details>`).join("")}
    </div>
    <div class="sheet-f"><button class="btn ghost" data-sheetclose>Закрыть</button><button class="btn" data-sheetclose>Показать ${n}</button></div></div>`;
  $("#sheet").hidden = false;
  document.body.style.overflow = "hidden";
}
function closeSheet() { $("#sheet").hidden = true; document.body.style.overflow = ""; }
function refreshSheet() {
  const open = $$("#sheet details").map(d => d.open), y = $("#sheet .sheet-b")?.scrollTop;
  openSheet();
  $$("#sheet details").forEach((d, i) => d.open = open[i] ?? d.open);
  if (y) $("#sheet .sheet-b").scrollTop = y;
}

// ═════════════════════ роутинг ═════════════════════
function parseHash() {
  const [path, qs] = location.hash.slice(1).split("?");
  return { parts: (path || "/").split("/").filter(Boolean), qs: new URLSearchParams(qs || "") };
}
const isCatalog = () => ["", "catalog", "new"].includes(parseHash().parts[0] || "");
function filtersToHash() {
  if (!isCatalog()) return;
  const sp = new URLSearchParams();
  if (state.q) sp.set("q", state.q);
  for (const fc of FACETS) for (const v of state.f[fc.k] || []) sp.append(fc.k, v);
  for (const tg of TOGGLES) if (state.f[tg.k] && !(tg.k === "new" && parseHash().parts[0] === "new")) sp.set(tg.k, "1");
  for (const k of ["pmin", "pmax"]) if (state.f[k]) sp.set(k, state.f[k]);
  const h = (parseHash().parts[0] === "new" ? "#/new" : "#/") + (sp.toString() ? "?" + sp : "");
  if (location.hash !== h) history.replaceState(null, "", h);
}
function hashToFilters(qs) {
  state.f = {};
  for (const fc of FACETS) { const v = qs.getAll(fc.k); if (v.length) state.f[fc.k] = v; }
  for (const tg of TOGGLES) if (qs.get(tg.k)) state.f[tg.k] = true;
  for (const k of ["pmin", "pmax"]) if (qs.get(k)) state.f[k] = qs.get(k);
  state.q = qs.get("q") || "";
  $("#q").value = state.q;
}
function route() {
  if (!DB) return;
  const { parts, qs } = parseHash();
  const page = parts[0] || "catalog";
  state.open = null; state.limit = 0;
  $$("[data-nav]").forEach(a => a.classList.toggle("on", a.dataset.nav === page));
  if (page === "lot") renderLot(parts[1], parts[2]);
  else if (page === "similar") renderSimilar(parts[1]);
  else if (page === "compare") renderCompare();
  else if (page === "roasters") renderRoasters();
  else { hashToFilters(qs); renderCatalog(page === "new" ? "new" : ""); }
  updateCounts();
}
function updateCounts() {
  $("#cmpCount").textContent = state.cmp.size || "";
  $("#newCount").textContent = new Set(DB.products.filter(p => p.is_new && !p.gone).map(p => p.lot)).size || "";
  let bar = $(".cmpbar");
  const show = state.cmp.size && parseHash().parts[0] !== "compare";
  if (!show) { bar?.remove(); return; }
  if (!bar) { bar = document.createElement("div"); bar.className = "cmpbar"; document.body.append(bar); }
  const ps = [...state.cmp].map(id => BYID[id]).filter(Boolean);
  bar.innerHTML = `<span class="thumbs-mini">${ps.slice(0, 4).map(p => p.image ? `<img src="${esc(p.image)}" alt="">` : "").join("")}</span><span>${ps.length} в сравнении</span><a class="btn sm" href="#/compare">Сравнить</a>`;
}
function toast(t) { const el = $("#toast"); el.textContent = t; el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => el.hidden = true, 1700); }
const rerender = () => { refresh(); if (!$("#sheet").hidden) refreshSheet(); };

// ═════════════════════ события ═════════════════════
document.addEventListener("click", e => {
  const t = e.target.closest("button, a, [data-open]");
  if (!t) { if (state.open && !e.target.closest(".pop")) { state.open = null; refresh(); } return; }
  const d = t.dataset;
  if (d.cmp) {
    e.preventDefault();
    if (state.cmp.has(d.cmp)) state.cmp.delete(d.cmp);
    else if (state.cmp.size >= 6) return toast("В сравнении уже 6 позиций");
    else { state.cmp.add(d.cmp); toast("Добавлено в сравнение"); }
    store.set("cmp", [...state.cmp]);
    $$(`[data-cmp="${d.cmp}"]`).forEach(b => b.classList.toggle("on", state.cmp.has(d.cmp)));
    updateCounts();
    if (parseHash().parts[0] === "compare") renderCompare();
  }
  else if (d.open) { state.popQ = ""; state.open = state.open === d.open ? null : d.open; refresh(); $("#popq")?.focus({ preventScroll: true }); }
  else if (d.close !== undefined) { state.open = null; refresh(); }
  else if (d.quick) {
    const q = QUICK[+d.quick];
    if (q.tg) state.f[q.tg] ? delete state.f[q.tg] : state.f[q.tg] = true;
    else if (q.price) { if (+state.f.pmax === q.price[1] && !state.f.pmin) { delete state.f.pmax; } else { delete state.f.pmin; state.f.pmax = String(q.price[1]); } }
    else { const a = (state.f[q.k] ||= []); const i = a.indexOf(q.v); i < 0 ? a.push(q.v) : a.splice(i, 1); }
    rerender();
  }
  else if (d.preset) { const [a, z] = d.preset.split("-"); a ? state.f.pmin = a : delete state.f.pmin; z ? state.f.pmax = z : delete state.f.pmax; refresh(); }
  else if (d.unf) { state.f[d.unf] = (state.f[d.unf] || []).filter(x => x !== d.v); rerender(); }
  else if (d.untg) { delete state.f[d.untg]; rerender(); }
  else if (d.clear) { if (d.clear === "price") { delete state.f.pmin; delete state.f.pmax; } else delete state.f[d.clear]; state.open = null; rerender(); }
  else if (d.clearq !== undefined) { state.q = ""; $("#q").value = ""; rerender(); }
  else if (d.reset !== undefined) { state.f = parseHash().parts[0] === "new" ? { new: true } : {}; state.q = ""; $("#q").value = ""; rerender(); }
  else if (d.view) { state.view = d.view; store.set("view", d.view); refresh(); }
  else if (d.more !== undefined) { state.limit = (state.limit || 120) + 120; const y = scrollY; refresh(); scrollTo(0, y); }
  else if (d.sheet !== undefined) openSheet();
  else if (d.sheetclose !== undefined) closeSheet();
  else if (d.img) { $("#lotImg").innerHTML = `<img src="${esc(d.img)}" alt="">`; $$(".thumbs button").forEach(b => b.classList.toggle("on", b === t)); }
  else if (d.back !== undefined && history.length > 1 && document.referrer === "" ) { /* обычный переход по ссылке */ }
  else if (d.sug) { e.preventDefault(); hideSuggest(); location.hash = d.sug; }
  else if (d.cmpclear !== undefined) { state.cmp.clear(); store.set("cmp", []); updateCounts(); renderCompare(); }
});
$("#sheet").addEventListener("click", e => { if (e.target.id === "sheet") closeSheet(); });
document.addEventListener("change", e => {
  const t = e.target;
  if (t.dataset.f) { const a = (state.f[t.dataset.f] ||= []); t.checked ? a.includes(t.value) || a.push(t.value) : a.splice(a.indexOf(t.value), 1); refresh(true); if (!$("#sheet").hidden) refreshSheet(); }
  else if (t.dataset.tg) { t.checked ? state.f[t.dataset.tg] = true : delete state.f[t.dataset.tg]; refresh(!!state.open); if (!$("#sheet").hidden) refreshSheet(); }
  else if (t.id === "sort") { state.sort = t.value; store.set("sort", t.value); refresh(); }
  else if (t.id === "pmin" || t.id === "pmax") { t.value ? state.f[t.id] = t.value : delete state.f[t.id]; refresh(true); if (!$("#sheet").hidden) refreshSheet(); }
  else if (t.id === "city") { state.city = t.value; store.set("city", t.value); route(); }
  else if (t.id === "simAvail") { store.set("simAvail", t.checked); route(); }
});
document.addEventListener("input", e => {
  if (e.target.id === "popq") { state.popQ = e.target.value; const fc = FACETS.find(f => f.k === state.open); if (fc) $("#popl").innerHTML = optList(fc, base(), state.popQ); }
});
document.addEventListener("keydown", e => {
  if (e.key === "/" && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) { e.preventDefault(); $("#q").focus(); }
  if (e.key === "Escape") { if (state.open) { state.open = null; refresh(); } if (!$("#sheet").hidden) closeSheet(); }
});

// поиск с подсказками
const qEl = $("#q"), sug = $("#suggest");
let sugIdx = -1, qTimer;
function hideSuggest() { sug.hidden = true; sugIdx = -1; }
function runSearch(q) { state.q = q; if (isCatalog()) refresh(); else location.hash = "#/?q=" + encodeURIComponent(q); }
qEl.addEventListener("input", () => {
  clearTimeout(qTimer);
  qTimer = setTimeout(() => {
    const q = qEl.value.trim();
    if (isCatalog()) runSearch(q);
    if (!q) return hideSuggest();
    const toks = qTokens(q), facets = [];
    const hit = v => v && toks.every(t => fold(v).includes(t.raw) || latin(v).includes(t.lat) || (t.syn && fold(v).includes(t.syn)));
    const pool = DB.products.filter(p => !p.gone);
    for (const [k, label, list] of [["country", "Страна", pool.map(p => p.country)], ["region", "Регион", pool.map(p => p.region)], ["process", "Обработка", pool.map(p => p.process)],
      ["variety", "Сорт", pool.flatMap(p => p.varieties || [])], ["flavor", "Вкус", pool.flatMap(p => p.flavors || [])], ["roaster", "Обжарщик", DB.roasters.filter(r => r.count).map(r => r.name)]])
      for (const v of new Set(list)) if (hit(v)) facets.push({ h: `#/?${k}=${encodeURIComponent(v)}`, t: v, s: label });
    const lots = new Map();
    for (const p of pool) { const s = score(p, toks); if (s && (!lots.has(p.lot) || lots.get(p.lot)[0] < s)) lots.set(p.lot, [s, p]); }
    const top = [...lots.values()].sort((a, b) => b[0] - a[0] || b[1]._multi - a[1]._multi).slice(0, 6);
    sug.innerHTML = (facets.length ? `<div class="grp">Фильтры</div>` + facets.slice(0, 4).map(o => `<button data-sug="${esc(o.h)}"><span class="s-t">${esc(o.t)}</span><em>${esc(o.s)}</em></button>`).join("") : "")
      + (top.length ? `<div class="grp">Лоты</div>` + top.map(([, p]) => `<button data-sug="#/lot/${p.lot}">${p.image ? `<img src="${esc(p.image)}" alt="">` : ""}<span class="s-t">${esc(nice(p.name))}</span><em>${p._multi > 1 ? `${p._multi} обжарщика` : esc(p._r.name)}</em></button>`).join("") : "")
      + `<button data-sug="#/?q=${encodeURIComponent(q)}"><span class="s-t"><b>Все результаты по «${esc(q)}»</b></span><em>Enter</em></button>`;
    sug.hidden = false; sugIdx = -1;
  }, 140);
});
qEl.addEventListener("focus", () => { if (qEl.value.trim() && sug.innerHTML) sug.hidden = false; });
qEl.addEventListener("keydown", e => {
  const items = $$("button", sug);
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault(); if (!items.length) return;
    sugIdx = (sugIdx + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items.forEach((b, i) => b.classList.toggle("on", i === sugIdx));
  } else if (e.key === "Enter") {
    e.preventDefault();
    if (sugIdx >= 0 && items[sugIdx]) location.hash = items[sugIdx].dataset.sug;
    else runSearch(qEl.value.trim());
    hideSuggest(); qEl.blur();
  } else if (e.key === "Escape") { hideSuggest(); qEl.blur(); }
});
document.addEventListener("click", e => { if (!e.target.closest("#searchbox")) hideSuggest(); });

// тема и город
const applyTheme = t => t ? document.documentElement.setAttribute("data-theme", t) : document.documentElement.removeAttribute("data-theme");
applyTheme(store.get("theme", null));
$("#theme").onclick = () => {
  const cur = document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  const t = cur === "dark" ? "light" : "dark"; store.set("theme", t); applyTheme(t);
};
$("#city").innerHTML = Object.keys(CITY_ZONE).sort((a, b) => a.localeCompare(b)).map(c => `<option ${c === state.city ? "selected" : ""}>${c}</option>`).join("");

window.addEventListener("hashchange", () => { const p = parseHash().parts[0]; route(); if (["lot", "similar", "compare", "roasters"].includes(p)) scrollTo(0, 0); });

fetch("data/catalog.json", { cache: "no-cache" })
  .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
  .then(cat => {
    prepare(cat);
    const g = new Date(cat.meta.generated);
    $("#meta").textContent = `Обновлено ${g.toLocaleString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })} · ${cat.products.filter(p => !p.gone).length} позиций`;
    route();
  })
  .catch(() => { $("#app").innerHTML = `<div class="empty"><h2>Каталог ещё не собран</h2>Запустите <code>python -m scraper.run</code>, чтобы выгрузить данные обжарщиков.</div>`; });
})();
