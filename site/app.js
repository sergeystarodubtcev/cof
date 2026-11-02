/* Зерно — клиентская часть. Без сборки и зависимостей: читает data/catalog.json. */
(() => {
"use strict";

// ───────────────────────── утилиты ─────────────────────────
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const rub = n => n == null ? "—" : Math.round(n).toLocaleString("ru-RU") + " ₽";
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
// синонимы, которые транслитом не ловятся
const SYN = {
  washed: "мытая", мытый: "мытая", natural: "натуральная", натурал: "натуральная", honey: "хани", мед: "хани",
  anaerobic: "анаэробная", анаэроб: "анаэробная", gesha: "гейша", geisha: "гейша", decaf: "декаф", "без кофеина": "декаф",
  filter: "filter", фильтр: "filter", эспрессо: "espresso", espresso: "espresso", омни: "omni", ягоды: "ягоды", berry: "ягоды",
  кения: "кения", kenya: "кения", ethiopia: "эфиопия", colombia: "колумбия", brazil: "бразилия", guatemala: "гватемала",
};
const ROAST = { filter: "Фильтр", espresso: "Эспрессо", omni: "Омни" };
const PALETTE = ["#b4532a", "#7a3b1a", "#3f7d4e", "#2f6f8f", "#8a4f9e", "#b07d1a", "#a33b4a", "#4f6b2a", "#5c4b8a", "#1f7a74"];
const colorOf = s => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return PALETTE[h % PALETTE.length]; };
const initials = s => String(s).replace(/[^\p{L}\p{N} ]/gu, "").split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join("").toUpperCase();

// ───────────────────── доставка: оценка сроков ─────────────────────
// Ориентировочные сроки СДЭК/Почты между зонами (рабочие дни). Это оценка, а не обещание магазина.
const CITY_ZONE = {
  "Москва": "MSK", "Санкт-Петербург": "SPB", "Тамбов": "CEN", "Воронеж": "CEN", "Ярославль": "CEN", "Тула": "CEN", "Нижний Новгород": "VOL",
  "Казань": "VOL", "Самара": "VOL", "Пермь": "VOL", "Ижевск": "VOL", "Уфа": "VOL", "Саратов": "VOL",
  "Екатеринбург": "URL", "Челябинск": "URL", "Тюмень": "URL", "Омск": "SIB", "Новосибирск": "SIB", "Томск": "SIB", "Красноярск": "SIB", "Барнаул": "SIB", "Иркутск": "SIB",
  "Краснодар": "SOU", "Ростов-на-Дону": "SOU", "Сочи": "SOU", "Волгоград": "SOU", "Калининград": "KGD", "Мурманск": "NW", "Архангельск": "NW",
  "Владивосток": "FE", "Хабаровск": "FE", "Якутск": "FE",
};
const ZONES = ["MSK", "SPB", "CEN", "VOL", "URL", "SIB", "SOU", "NW", "KGD", "FE"];
const T = [ // [min,max] дней  MSK     SPB     CEN     VOL     URL     SIB     SOU     NW      KGD     FE
  /*MSK*/ [[1,1],[1,2],[1,3],[2,3],[2,4],[3,5],[2,4],[3,5],[3,5],[6,10]],
  /*SPB*/ [[1,2],[1,1],[2,3],[2,4],[3,5],[4,6],[3,5],[2,4],[3,5],[7,11]],
  /*CEN*/ [[1,3],[2,3],[1,2],[2,4],[3,5],[4,6],[2,4],[3,6],[4,6],[7,11]],
  /*VOL*/ [[2,3],[2,4],[2,4],[1,3],[2,3],[3,5],[3,5],[4,6],[4,7],[6,10]],
  /*URL*/ [[2,4],[3,5],[3,5],[2,3],[1,2],[2,4],[3,6],[4,7],[5,7],[5,9]],
  /*SIB*/ [[3,5],[4,6],[4,6],[3,5],[2,4],[1,3],[4,7],[5,8],[5,8],[4,7]],
];
function transit(from, to) {
  const a = ZONES.indexOf(CITY_ZONE[from] || "CEN"), b = ZONES.indexOf(CITY_ZONE[to] || "CEN");
  if (a < 0 || b < 0) return [3, 7];
  if (a === b) return [1, 2];
  // для зон-отправителей без строки — используем симметрию матрицы
  return T[a]?.[b] || T[b]?.[a] || [3, 7];
}
function deliveryEst(r, city) {
  if (!r || !city) return null;
  const lag = r.roast_lag ?? 1, [lo, hi] = transit(r.city, city);
  return { lo: lo + lag, hi: hi + lag + (lag ? 1 : 0), same: r.city === city };
}
const fmtDlv = d => !d ? "—" : d.same ? `${d.lo}–${d.hi} дн. · курьер` : `${d.lo}–${d.hi} дн.`;

// ───────────────────────── данные ─────────────────────────
let DB = null, R = {}, LOTS = {};
const state = {
  f: {}, sort: store.get("sort", "rel"), view: store.get("view", "lots"),
  cmp: new Set(store.get("cmp", [])), city: store.get("city", "Москва"), q: "",
};

function prepare(cat) {
  DB = cat;
  R = Object.fromEntries(cat.roasters.map(r => [r.id, r]));
  LOTS = {};
  for (const p of cat.products) {
    const r = R[p.roaster] || { name: p.roaster };
    p._r = r;
    const txt = [p.name, r.name, r.city, p.country, p.region, p.process, ...(p.varieties || []), ...(p.flavors || []), p.notes, ROAST[p.roast], p.roast, p.is_decaf ? "декаф" : "", p.is_blend ? "смесь бленд" : ""].filter(Boolean).join(" ");
    p._f = fold(txt + " " + (p.description || "").slice(0, 400));
    p._l = latin(txt);
    p._n = fold(p.name) + " " + latin(p.name);
    (LOTS[p.lot] ||= []).push(p);
  }
  for (const [id, ps] of Object.entries(LOTS)) {
    ps.sort((a, b) => (b.available - a.available) || ((a.price_100g ?? 1e9) - (b.price_100g ?? 1e9)));
    const roasters = new Set(ps.map(p => p.roaster));
    for (const p of ps) p._multi = roasters.size;
  }
}

// ───────────────────────── поиск ─────────────────────────
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

// ───────────────────────── фильтры ─────────────────────────
const FACETS = [
  { k: "country", t: "Страна", get: p => p.country, top: 10 },
  { k: "region", t: "Регион", get: p => p.region, top: 10 },
  { k: "process", t: "Обработка", get: p => p.process },
  { k: "roast", t: "Обжарка под", get: p => ROAST[p.roast] },
  { k: "flavor", t: "Вкус", get: p => p.flavors, top: 12 },
  { k: "variety", t: "Сорт", get: p => p.varieties, top: 10 },
  { k: "roaster", t: "Обжарщик", get: p => p._r.name, top: 12 },
  { k: "city", t: "Город обжарщика", get: p => p._r.city, top: 8 },
];
const TOGGLES = [
  { k: "instock", t: "Только в наличии", test: p => p.available },
  { k: "multi", t: "Есть у нескольких обжарщиков", test: p => p._multi > 1 },
  { k: "new", t: "Новинки (14 дней)", test: p => p.is_new },
  { k: "noblend", t: "Без смесей", test: p => !p.is_blend },
  { k: "nodecaf", t: "Без декафа", test: p => !p.is_decaf },
  { k: "fast", t: "Доставка до 3 дней", test: p => (deliveryEst(p._r, state.city)?.hi ?? 99) <= 3 },
];
const vals = (fc, p) => { const v = fc.get(p); return Array.isArray(v) ? v : v ? [v] : []; };

function applyFilters(list, skip) {
  const f = state.f;
  return list.filter(p => {
    for (const fc of FACETS) {
      if (fc.k === skip || !f[fc.k]?.length) continue;
      const v = vals(fc, p);
      if (!f[fc.k].some(x => v.includes(x))) return false;
    }
    for (const tg of TOGGLES) if (f[tg.k] && !tg.test(p)) return false;
    if (f.pmin && (p.price_100g ?? 0) < +f.pmin) return false;
    if (f.pmax && (p.price_100g ?? 1e9) > +f.pmax) return false;
    if (f.alt && !(p.altitude && p.altitude[1] >= +f.alt)) return false;
    return true;
  });
}

function results() {
  let list = DB.products;
  const toks = qTokens(state.q);
  if (toks.length) { for (const p of list) p._s = score(p, toks); list = list.filter(p => p._s > 0); }
  return applyFilters(list);
}

function sortList(list) {
  const by = {
    rel: (a, b) => (b._s || 0) - (a._s || 0) || (b.available - a.available) || (b._multi - a._multi) || (b.is_new - a.is_new),
    price: (a, b) => (a.price_100g ?? 1e9) - (b.price_100g ?? 1e9),
    pricedesc: (a, b) => (b.price_100g ?? -1) - (a.price_100g ?? -1),
    new: (a, b) => b.first_seen.localeCompare(a.first_seen),
    multi: (a, b) => b._multi - a._multi || (a.price_100g ?? 1e9) - (b.price_100g ?? 1e9),
    score: (a, b) => (b.score ?? 0) - (a.score ?? 0),
  }[state.sort] || (() => 0);
  return [...list].sort(by);
}

// ───────────────────────── рендер: общие куски ─────────────────────────
function cover(p, big) {
  if (p.image) return `<img src="${esc(p.image)}" alt="${esc(p.name)}" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'ph',innerHTML:'${esc(esc(p.country || "Кофе"))}'}))">`;
  const c = colorOf(p.country || p.name);
  return `<div class="ph" style="background:linear-gradient(135deg,${c},${colorOf((p.region || "") + p.roaster)})"><div>${esc(p.country || (p.is_blend ? "Смесь" : "Кофе"))}${p.region ? `<small>${esc(p.region)}</small>` : ""}</div></div>`;
}
const avatar = r => `<span class="av" title="${esc(r.name)}" style="background:${colorOf(r.id)}">${esc(initials(r.name))}</span>`;
const origin = p => [p.country, p.region, p.process].filter(Boolean).join(" · ") || (p.is_blend ? "Смесь" : "");
function tags(p) {
  const t = [];
  if (p.roast) t.push(ROAST[p.roast]);
  for (const v of (p.varieties || []).slice(0, 2)) t.push(v);
  if (p.altitude) t.push(`${p.altitude[0]}${p.altitude[1] !== p.altitude[0] ? "–" + p.altitude[1] : ""} м`);
  if (p.score) t.push(`SCA ${p.score}`);
  return t.map(x => `<span class="tag">${esc(x)}</span>`).join("");
}
const cmpIcon = id => `<button class="cmp-btn ${state.cmp.has(id) ? "on" : ""}" data-cmp="${id}" title="Сравнить"><svg viewBox="0 0 24 24"><path d="M8 3v18M16 3v18M3 8h5M16 16h5"/></svg></button>`;

function lotCard(ps) {
  const head = ps.find(p => p.image) || ps[0];
  const av = ps.filter(p => p.available);
  const pr = (av.length ? av : ps).map(p => p.price_100g).filter(x => x != null);
  const rs = [...new Map(ps.map(p => [p.roaster, p._r])).values()];
  const names = ps.map(p => p.name).sort((a, b) => a.length - b.length);
  const name = names.find(n => /[а-я]/i.test(n)) || names[0]; // русское название приоритетнее
  return `<article class="card">
    <a class="cover" href="#/lot/${head.lot}">${cover(head)}
      <div class="badges">${rs.length > 1 ? `<span class="badge multi">${rs.length} ${plural(rs.length, "обжарщик", "обжарщика", "обжарщиков")}</span>` : ""}${ps.some(p => p.is_new) ? `<span class="badge new">Новинка</span>` : ""}${!av.length ? `<span class="badge out">Нет в наличии</span>` : ""}</div></a>
    ${cmpIcon(head.id)}
    <div class="body">
      <div class="origin">${esc(origin(head))}</div>
      <h3><a href="#/lot/${head.lot}">${esc(name)}</a></h3>
      ${head.notes ? `<div class="notes">${esc(head.notes)}</div>` : ""}
      <div class="tags">${tags(head)}</div>
      <div class="price">${pr.length ? `<b>${rub(Math.min(...pr))}</b><span>${pr.length > 1 && Math.max(...pr) !== Math.min(...pr) ? "– " + rub(Math.max(...pr)) + " " : ""}за 100 г</span>` : `<b>${rub(head.price_from)}</b><span>от</span>`}</div>
      <div class="roasters-line">${rs.slice(0, 5).map(avatar).join("")}<span>${rs.length === 1 ? esc(rs[0].name) : ""}</span></div>
    </div></article>`;
}
function itemCard(p) {
  const d = deliveryEst(p._r, state.city);
  return `<article class="card">
    <a class="cover" href="#/lot/${p.lot}/${p.id}">${cover(p)}
      <div class="badges">${p._multi > 1 ? `<span class="badge multi">ещё у ${p._multi - 1}</span>` : ""}${p.is_new ? `<span class="badge new">Новинка</span>` : ""}${!p.available ? `<span class="badge out">Нет в наличии</span>` : ""}</div></a>
    ${cmpIcon(p.id)}
    <div class="body">
      <div class="origin">${esc(origin(p))}</div>
      <h3><a href="#/lot/${p.lot}/${p.id}">${esc(p.name)}</a></h3>
      ${p.notes ? `<div class="notes">${esc(p.notes)}</div>` : ""}
      <div class="tags">${tags(p)}</div>
      <div class="price"><b>${p.price_100g ? rub(p.price_100g) : rub(p.price_from)}</b><span>${p.price_100g ? "за 100 г" : "от"}</span></div>
      <div class="roasters-line">${avatar(p._r)}<span>${esc(p._r.name)} · ${fmtDlv(d)}</span></div>
    </div></article>`;
}

// ───────────────────────── страница: каталог ─────────────────────────
function facetHTML(fc, base) {
  const counts = new Map();
  for (const p of applyFilters(base, fc.k)) for (const v of new Set(vals(fc, p))) counts.set(v, (counts.get(v) || 0) + 1);
  const sel = state.f[fc.k] || [];
  for (const s of sel) if (!counts.has(s)) counts.set(s, 0);
  if (!counts.size) return "";
  const arr = [...counts].sort((a, b) => sel.includes(b[0]) - sel.includes(a[0]) || b[1] - a[1]);
  const open = store.get("open_" + fc.k, false);
  const shown = fc.top && !open ? arr.slice(0, fc.top) : arr;
  return `<div class="fgroup"><h4>${fc.t}${sel.length ? `<button data-clear="${fc.k}">сбросить</button>` : ""}</h4><div class="chips">
    ${shown.map(([v, n]) => `<button class="chip ${sel.includes(v) ? "on" : ""}" data-f="${fc.k}" data-v="${esc(v)}" ${!n && !sel.includes(v) ? "disabled" : ""}>${esc(v)} <small>${n}</small></button>`).join("")}
  </div>${fc.top && arr.length > fc.top ? `<button class="more" data-more="${fc.k}">${open ? "свернуть" : `ещё ${arr.length - fc.top}`}</button>` : ""}</div>`;
}

function renderCatalog(mode) {
  if (mode === "new") state.f.new = true;
  let base = DB.products;
  const toks = qTokens(state.q);
  if (toks.length) { for (const p of base) p._s = score(p, toks); base = base.filter(p => p._s > 0); }
  const list = sortList(applyFilters(base));
  const lotsMap = new Map();
  for (const p of list) (lotsMap.get(p.lot) || lotsMap.set(p.lot, []).get(p.lot)).push(p);
  const nLots = lotsMap.size;
  const active = [];
  for (const fc of FACETS) for (const v of state.f[fc.k] || []) active.push(`<button class="chip" data-f="${fc.k}" data-v="${esc(v)}">${esc(v)} ✕</button>`);
  for (const tg of TOGGLES) if (state.f[tg.k]) active.push(`<button class="chip" data-tg="${tg.k}">${tg.t} ✕</button>`);
  if (state.f.pmin || state.f.pmax) active.push(`<button class="chip" data-clear="price">${state.f.pmin || 0}–${state.f.pmax || "∞"} ₽/100 г ✕</button>`);
  const live = DB.roasters.filter(r => r.count);
  const multi = new Set(DB.products.filter(p => p._multi > 1).map(p => p.lot)).size;
  const cards = state.view === "lots" ? [...lotsMap.values()].slice(0, 400).map(lotCard) : list.slice(0, 400).map(itemCard);

  $("#app").innerHTML = `
  ${mode !== "new" && !state.q ? `<section class="hero"><div>
      <h1>Один и тот же кофе.<br><i>Все обжарщики</i> рядом.</h1>
      <p>Ищите лот по стране, ферме или вкусу и сравнивайте цену за 100 г, обработку и сроки доставки в выбранный город у российских specialty-обжарщиков.</p></div>
      <div class="stats"><div class="stat"><b>${DB.products.filter(p => p.available).length}</b><span>кофе в наличии</span></div>
      <div class="stat"><b>${live.length}</b><span>обжарщиков</span></div>
      <div class="stat"><b>${multi}</b><span>лотов у 2+ обжарщиков</span></div></div></section>`
    : `<section class="section"><h2>${mode === "new" ? "Новинки за 14 дней" : `Поиск: «${esc(state.q)}»`}</h2></section>`}
  <div class="layout">
    <aside class="filters" id="filters">
      <div class="fgroup">${TOGGLES.map(tg => `<label class="toggle">${tg.t}<input type="checkbox" data-tg="${tg.k}" ${state.f[tg.k] ? "checked" : ""}></label>`).join("")}</div>
      <div class="fgroup"><h4>Цена за 100 г, ₽</h4><div class="range"><input type="number" inputmode="numeric" placeholder="от" id="pmin" value="${esc(state.f.pmin || "")}"> — <input type="number" inputmode="numeric" placeholder="до" id="pmax" value="${esc(state.f.pmax || "")}"></div></div>
      ${FACETS.map(fc => facetHTML(fc, base)).join("")}
      <div class="fgroup"><h4>Высота от, м</h4><div class="range"><input type="number" step="100" placeholder="напр. 1800" id="alt" value="${esc(state.f.alt || "")}"></div></div>
      <button class="reset" data-reset>Сбросить всё</button>
    </aside>
    <section>
      <div class="bar">
        <button class="btn ghost mfilters" data-togglef>Фильтры</button>
        <span class="count"><b>${state.view === "lots" ? nLots : list.length}</b> ${state.view === "lots" ? plural(nLots, "лот", "лота", "лотов") : plural(list.length, "товар", "товара", "товаров")}</span>
        <div class="seg"><button data-view="lots" class="${state.view === "lots" ? "on" : ""}">Лоты</button><button data-view="items" class="${state.view === "items" ? "on" : ""}">Все предложения</button></div>
        <select id="sort">${[["rel", "Сначала релевантные"], ["price", "Дешевле за 100 г"], ["pricedesc", "Дороже за 100 г"], ["multi", "У большего числа обжарщиков"], ["new", "Сначала новые"], ["score", "По оценке SCA"]].map(([v, t]) => `<option value="${v}" ${state.sort === v ? "selected" : ""}>${t}</option>`).join("")}</select>
      </div>
      ${active.length ? `<div class="active">${active.join("")}</div>` : ""}
      ${cards.length ? `<div class="grid">${cards.join("")}</div>` : `<div class="empty"><h2>Ничего не нашлось</h2>Попробуйте убрать часть фильтров или написать запрос иначе: по-русски или по-английски.</div>`}
    </section>
  </div>`;
}

// ───────────────────────── страница: лот ─────────────────────────
function spark(h) {
  if (!h || h.length < 2) return "";
  const ys = h.map(x => x[1]), lo = Math.min(...ys), hi = Math.max(...ys), w = 60, ht = 18;
  const pts = ys.map((y, i) => `${(i / (ys.length - 1)) * w},${hi === lo ? ht / 2 : ht - ((y - lo) / (hi - lo)) * ht}`).join(" ");
  const up = ys.at(-1) > ys[0];
  return `<svg class="spark" width="${w}" height="${ht}" viewBox="0 -2 ${w} ${ht + 4}" style="stroke:${up ? "var(--accent)" : "var(--ok)"};width:${w}px;height:${ht}px"><polyline points="${pts}"/><title>${h.map(x => x[0] + ": " + rub(x[1])).join("\n")}</title></svg>`;
}

function renderLot(lotId, focusId) {
  const ps = LOTS[lotId];
  if (!ps) return renderNotFound();
  const focus = ps.find(p => p.id === focusId) || ps.find(p => p.image) || ps[0];
  const imgs = ps.filter(p => p.image);
  const avail = ps.filter(p => p.available && p.price_100g != null);
  const best = avail[0];
  const sortKey = store.get("lotSort", "price");
  const rows = [...ps].sort({
    price: (a, b) => (b.available - a.available) || (a.price_100g ?? 1e9) - (b.price_100g ?? 1e9),
    dlv: (a, b) => (deliveryEst(a._r, state.city)?.lo ?? 99) - (deliveryEst(b._r, state.city)?.lo ?? 99),
    name: (a, b) => a._r.name.localeCompare(b._r.name),
  }[sortKey]);
  const similar = DB.products.filter(p => p.origin_key === focus.origin_key && p.lot !== lotId && !p.origin_key.startsWith("?"));
  const simLots = [...new Map(similar.map(p => [p.lot, LOTS[p.lot]])).values()].slice(0, 8);
  const spec = (t, v) => v ? `<div class="spec"><span>${t}</span><b>${esc(v)}</b></div>` : "";
  const merged = k => [...new Set(ps.flatMap(p => [].concat(p[k] || [])))];

  $("#app").innerHTML = `
  <a class="back" href="#/" onclick="history.length>1&&(event.preventDefault(),history.back())">← к каталогу</a>
  <section class="lot-head">
    <div><div class="lot-img" id="lotImg">${cover(focus, true)}</div>
      ${imgs.length > 1 ? `<div class="thumbs">${imgs.map(p => `<button data-img="${esc(p.image)}" class="${p === focus ? "on" : ""}" title="${esc(p._r.name)}"><img src="${esc(p.image)}" alt=""></button>`).join("")}</div>` : ""}
    </div>
    <div class="lot-info">
      <div class="origin" style="color:var(--ink2);text-transform:uppercase;letter-spacing:.06em;font-size:12px">${esc(origin(focus))}</div>
      <h1>${esc(focus.name)}</h1>
      ${focus.notes ? `<p style="font-size:17px;margin:0">${esc(focus.notes)}</p>` : ""}
      <div class="specs">
        ${spec("Страна", focus.country)}${spec("Регион", focus.region)}${spec("Обработка", merged("process").join(", "))}
        ${spec("Сорт", merged("varieties").join(", "))}${spec("Высота", focus.altitude && `${focus.altitude[0]}–${focus.altitude[1]} м`)}
        ${spec("Обжарка", merged("roast").map(r => ROAST[r]).join(", "))}${spec("Оценка SCA", merged("score").join(" / "))}
        ${spec("Вкус", merged("flavors").join(", "))}
      </div>
      ${best ? `<div class="best"><div><small style="opacity:.7">Выгоднее всего · ${esc(best._r.name)}</small><br><b>${rub(best.price_100g)}</b> <span style="opacity:.7">за 100 г</span></div>
        <div><small style="opacity:.7">Доставка · ${esc(state.city)}</small><br><b style="font-size:20px">${fmtDlv(deliveryEst(best._r, state.city))}</b></div>
        <a class="btn" href="${esc(best.url)}" target="_blank" rel="noopener">Заказать на сайте →</a></div>` : `<div class="best">Сейчас нет в наличии ни у одного обжарщика. Мы покажем лот снова, как только он появится.</div>`}
    </div>
  </section>

  <div class="section"><h2>${ps.length} ${plural(ps.length, "предложение", "предложения", "предложений")}</h2><span>у ${new Set(ps.map(p => p.roaster)).size} ${plural(new Set(ps.map(p => p.roaster)).size, "обжарщика", "обжарщиков", "обжарщиков")}</span></div>
  <table class="offers"><thead><tr>
    <th data-lsort="name">Обжарщик</th><th>Фасовки</th><th data-lsort="price">₽ / 100 г</th><th data-lsort="dlv">Доставка · ${esc(state.city)}</th><th>Наличие</th><th></th></tr></thead><tbody>
    ${rows.map((p, i) => {
      const d = deliveryEst(p._r, state.city);
      return `<tr class="${p === best ? "top1" : ""}">
      <td class="c-r"><div class="rname">${p.image ? `<img src="${esc(p.image)}" alt="">` : avatar(p._r)}<div><b>${esc(p._r.name)}</b><br><small>${esc(p._r.city)} · ${esc(p.name)}</small></div></div></td>
      <td>${(p.variants || []).map(v => `<span class="w ${v.a ? "" : "na"}">${v.w ? (v.w >= 1000 ? v.w / 1000 + " кг" : v.w + " г") : "—"} · ${rub(v.p)}</span>`).join(" ")}</td>
      <td><b>${rub(p.price_100g)}</b>${spark(p.price_history)}</td>
      <td class="dlv">${fmtDlv(d)}<br><small>${esc((p._r.delivery?.methods || []).join(", ") || "СДЭК / Почта")}${p._r.delivery?.free_from ? ` · бесплатно от ${rub(p._r.delivery.free_from)}` : ""}</small></td>
      <td><span class="dot ${p.available ? "" : "no"}"></span>${p.gone ? "снят с продажи" : p.available ? "есть" : "нет"}</td>
      <td><a class="btn ${p.available ? "" : "ghost"}" href="${esc(p.url)}" target="_blank" rel="noopener">${p.available ? "Заказать" : "На сайт"} →</a> ${cmpIcon(p.id).replace("cmp-btn", "cmp-btn inline").replace('position:absolute', '')}</td></tr>`;
    }).join("")}
  </tbody></table>
  ${focus.description ? `<div class="section"><h2>Описание от обжарщика</h2><span>${esc(focus._r.name)}</span></div><div class="desc">${esc(focus.description)}</div>` : ""}
  ${simLots.length ? `<div class="section"><h2>Похожие лоты</h2><span>${esc(origin(focus))}</span></div><div class="grid">${simLots.map(lotCard).join("")}</div>` : ""}`;
  document.querySelectorAll(".cmp-btn.inline").forEach(b => Object.assign(b.style, { position: "static", display: "inline-grid", verticalAlign: "middle", marginLeft: "6px" }));
}

// ───────────────────────── страница: сравнение ─────────────────────────
function renderCompare() {
  const ps = [...state.cmp].map(id => DB.products.find(p => p.id === id)).filter(Boolean);
  if (!ps.length) { $("#app").innerHTML = `<div class="empty"><h2>Сравнение пустое</h2>Нажмите на значок ⇄ на карточке кофе, чтобы добавить до 6 позиций.<br><br><a class="btn" href="#/">В каталог</a></div>`; return; }
  const minP = Math.min(...ps.map(p => p.price_100g ?? 1e9));
  const minD = Math.min(...ps.map(p => deliveryEst(p._r, state.city)?.hi ?? 99));
  const maxS = Math.max(...ps.map(p => p.score ?? 0));
  const row = (t, f) => `<tr><th>${t}</th>${ps.map(p => `<td>${f(p)}</td>`).join("")}</tr>`;
  $("#app").innerHTML = `<div class="section"><h2>Сравнение</h2><span>${ps.length} из 6 · <a href="#" data-cmpclear>очистить</a></span></div>
  <div class="cmp-wrap"><table class="cmp">
    ${row("", p => `<button class="x" data-cmp="${p.id}">✕</button><a href="#/lot/${p.lot}/${p.id}">${p.image ? `<img src="${esc(p.image)}" alt="">` : `<div style="width:120px;height:120px;position:relative;border-radius:10px;overflow:hidden">${cover(p)}</div>`}</a>`)}
    ${row("Кофе", p => `<b>${esc(p.name)}</b>`)}
    ${row("Обжарщик", p => `${esc(p._r.name)}<br><small>${esc(p._r.city)}</small>`)}
    ${row("₽ / 100 г", p => `<span class="${p.price_100g === minP ? "win" : ""}">${rub(p.price_100g)}</span>`)}
    ${row("Фасовки", p => (p.variants || []).map(v => `<span class="w">${v.w ? v.w + " г" : "—"} · ${rub(v.p)}</span>`).join(" "))}
    ${row("Доставка · " + esc(state.city), p => { const d = deliveryEst(p._r, state.city); return `<span class="${d?.hi === minD ? "win" : ""}">${fmtDlv(d)}</span>`; })}
    ${row("Страна / регион", p => esc([p.country, p.region].filter(Boolean).join(", ") || "—"))}
    ${row("Обработка", p => esc(p.process || "—"))}
    ${row("Сорт", p => esc((p.varieties || []).join(", ") || "—"))}
    ${row("Высота", p => p.altitude ? `${p.altitude[0]}–${p.altitude[1]} м` : "—")}
    ${row("Обжарка", p => esc(ROAST[p.roast] || "—"))}
    ${row("Дескрипторы", p => esc(p.notes || (p.flavors || []).join(", ") || "—"))}
    ${row("SCA", p => p.score ? `<span class="${p.score === maxS ? "win" : ""}">${p.score}</span>` : "—")}
    ${row("Наличие", p => `<span class="dot ${p.available ? "" : "no"}"></span>${p.available ? "есть" : "нет"}`)}
    ${row("", p => `<a class="btn" href="${esc(p.url)}" target="_blank" rel="noopener">Заказать →</a>`)}
  </table></div>`;
}

// ───────────────────────── страница: обжарщики ─────────────────────────
function renderRoasters() {
  const rs = [...DB.roasters].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  $("#app").innerHTML = `<div class="section"><h2>Обжарщики</h2><span>${rs.filter(r => r.count).length} с актуальным каталогом из ${rs.length}</span></div>
  <div class="rgrid">${rs.map(r => {
    const d = deliveryEst(r, state.city);
    const st = r.ok ? `<span class="status ok">● обновлено ${r.checked_at ? new Date(r.checked_at).toLocaleDateString("ru-RU") : ""}</span>` : r.stale ? `<span class="status st">● сайт не ответил, данные прошлой выгрузки</span>` : `<span class="status no">● каталог пока не получен</span>`;
    return `<article class="rcard"><header>${avatar(r)}<div><h3>${esc(r.name)}</h3><div class="city-l">${esc(r.city)}</div></div></header>
      ${r.award ? `<div class="award">★ ${esc(r.award)}</div>` : ""}
      <div class="row">Кофе в каталоге<b>${r.count}</b></div>
      <div class="row">Доставка · ${esc(state.city)}<b>${fmtDlv(d)}</b></div>
      ${r.roast ? `<div class="row">Обжарка<b>${esc(r.roast)}</b></div>` : ""}
      ${r.delivery?.methods ? `<div class="row">Способы<b>${esc(r.delivery.methods.join(", "))}</b></div>` : ""}
      ${r.delivery?.free_from ? `<div class="row">Бесплатно от<b>${rub(r.delivery.free_from)}</b></div>` : ""}
      ${st}
      <div class="actions">${r.count ? `<a class="btn" href="#/?roaster=${encodeURIComponent(r.name)}">Каталог</a>` : ""}<a class="btn ghost" href="${esc(r.site)}" target="_blank" rel="noopener">Сайт →</a></div></article>`;
  }).join("")}</div>`;
}

const renderNotFound = () => { $("#app").innerHTML = `<div class="empty"><h2>Лот не найден</h2>Возможно, он снят с продажи.<br><br><a class="btn" href="#/">В каталог</a></div>`; };

// ───────────────────────── роутинг ─────────────────────────
function parseHash() {
  const [path, qs] = location.hash.slice(1).split("?");
  return { parts: (path || "/").split("/").filter(Boolean), qs: new URLSearchParams(qs || "") };
}
function filtersToHash() {
  const sp = new URLSearchParams();
  if (state.q) sp.set("q", state.q);
  for (const fc of FACETS) for (const v of state.f[fc.k] || []) sp.append(fc.k, v);
  for (const tg of TOGGLES) if (state.f[tg.k]) sp.set(tg.k, "1");
  for (const k of ["pmin", "pmax", "alt"]) if (state.f[k]) sp.set(k, state.f[k]);
  const { parts } = parseHash();
  const base = parts[0] === "new" ? "#/new" : "#/";
  const h = base + (sp.toString() ? "?" + sp : "");
  if (location.hash !== h) history.replaceState(null, "", h);
}
function hashToFilters(qs) {
  state.f = {};
  for (const fc of FACETS) { const v = qs.getAll(fc.k); if (v.length) state.f[fc.k] = v; }
  for (const tg of TOGGLES) if (qs.get(tg.k)) state.f[tg.k] = true;
  for (const k of ["pmin", "pmax", "alt"]) if (qs.get(k)) state.f[k] = qs.get(k);
  state.q = qs.get("q") || "";
  $("#q").value = state.q;
}
function route() {
  if (!DB) return;
  const { parts, qs } = parseHash();
  const page = parts[0] || "catalog";
  document.querySelectorAll("[data-nav]").forEach(a => a.classList.toggle("on", a.dataset.nav === (page === "lot" ? "" : page)));
  if (page === "lot") renderLot(parts[1], parts[2]);
  else if (page === "compare") renderCompare();
  else if (page === "roasters") renderRoasters();
  else { hashToFilters(qs); renderCatalog(page === "new" ? "new" : ""); }
  updateCounts();
}
const rerender = () => { filtersToHash(); const y = scrollY; renderCatalog(parseHash().parts[0] === "new" ? "new" : ""); scrollTo(0, y); };

function updateCounts() {
  $("#cmpCount").textContent = state.cmp.size || "";
  $("#newCount").textContent = new Set(DB.products.filter(p => p.is_new).map(p => p.lot)).size || "";
}
function toast(t) { const el = $("#toast"); el.textContent = t; el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => el.hidden = true, 1800); }

// ───────────────────────── события ─────────────────────────
document.addEventListener("click", e => {
  const t = e.target.closest("button, a");
  if (!t) return;
  const d = t.dataset;
  if (d.cmp) {
    e.preventDefault();
    if (state.cmp.has(d.cmp)) state.cmp.delete(d.cmp);
    else if (state.cmp.size >= 6) return toast("В сравнении уже 6 позиций");
    else { state.cmp.add(d.cmp); toast("Добавлено в сравнение"); }
    store.set("cmp", [...state.cmp]);
    document.querySelectorAll(`[data-cmp="${d.cmp}"]`).forEach(b => b.classList.toggle("on", state.cmp.has(d.cmp)));
    updateCounts();
    if (parseHash().parts[0] === "compare") renderCompare();
  } else if (d.cmpclear !== undefined) { e.preventDefault(); state.cmp.clear(); store.set("cmp", []); updateCounts(); renderCompare(); }
  else if (d.f) { const a = (state.f[d.f] ||= []); const i = a.indexOf(d.v); i < 0 ? a.push(d.v) : a.splice(i, 1); rerender(); }
  else if (d.tg && t.tagName === "BUTTON") { delete state.f[d.tg]; rerender(); }
  else if (d.clear) { if (d.clear === "price") { delete state.f.pmin; delete state.f.pmax; } else delete state.f[d.clear]; rerender(); }
  else if (d.more) { store.set("open_" + d.more, !store.get("open_" + d.more, false)); rerender(); }
  else if (d.reset !== undefined) { state.f = {}; state.q = ""; $("#q").value = ""; rerender(); }
  else if (d.view) { state.view = d.view; store.set("view", d.view); rerender(); }
  else if (d.togglef !== undefined) $("#filters").classList.toggle("open");
  else if (d.img) { $("#lotImg").innerHTML = `<img src="${esc(d.img)}" alt="">`; document.querySelectorAll(".thumbs button").forEach(b => b.classList.toggle("on", b === t)); }
  else if (d.lsort) { store.set("lotSort", d.lsort); route(); }
  else if (d.sug) { e.preventDefault(); location.hash = d.sug; hideSuggest(); }
});
document.addEventListener("change", e => {
  const t = e.target;
  if (t.dataset.tg) { t.checked ? state.f[t.dataset.tg] = true : delete state.f[t.dataset.tg]; rerender(); }
  else if (t.id === "sort") { state.sort = t.value; store.set("sort", t.value); rerender(); }
  else if (["pmin", "pmax", "alt"].includes(t.id)) { t.value ? state.f[t.id] = t.value : delete state.f[t.id]; rerender(); }
  else if (t.id === "city") { state.city = t.value; store.set("city", t.value); route(); }
});

// поиск с подсказками
const qEl = $("#q"), sug = $("#suggest");
let sugIdx = -1, qTimer;
function hideSuggest() { sug.hidden = true; sugIdx = -1; }
qEl.addEventListener("input", () => {
  clearTimeout(qTimer);
  qTimer = setTimeout(() => {
    const q = qEl.value.trim();
    if (!q) { hideSuggest(); state.q = ""; if (["", "catalog", "new"].includes(parseHash().parts[0] || "")) rerender(); return; }
    const toks = qTokens(q), out = [];
    const facetHit = (k, label, vals) => { for (const v of vals) if (v && toks.every(t => fold(v).includes(t.raw) || latin(v).includes(t.lat) || (t.syn && fold(v).includes(t.syn)))) out.push({ h: `#/?${k}=${encodeURIComponent(v)}`, t: v, s: label }); };
    facetHit("country", "страна", [...new Set(DB.products.map(p => p.country))]);
    facetHit("region", "регион", [...new Set(DB.products.map(p => p.region))]);
    facetHit("process", "обработка", [...new Set(DB.products.map(p => p.process))]);
    facetHit("roaster", "обжарщик", DB.roasters.filter(r => r.count).map(r => r.name));
    const lots = new Map();
    for (const p of DB.products) { const s = score(p, toks); if (s && !lots.has(p.lot)) lots.set(p.lot, [s, p]); }
    for (const [, p] of [...lots.values()].sort((a, b) => b[0] - a[0] || b[1]._multi - a[1]._multi).slice(0, 6))
      out.push({ h: `#/lot/${p.lot}`, t: p.name, s: p._multi > 1 ? `${p._multi} обжарщика` : p._r.name });
    sug.innerHTML = out.slice(0, 9).map((o, i) => `<button data-sug="${esc(o.h)}">${esc(o.t)}<em>${esc(o.s)}</em></button>`).join("") +
      `<button data-sug="#/?q=${encodeURIComponent(q)}"><b>Все результаты по «${esc(q)}»</b><em>Enter</em></button>`;
    sug.hidden = false; sugIdx = -1;
  }, 120);
});
qEl.addEventListener("keydown", e => {
  const items = [...sug.querySelectorAll("button")];
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault(); sugIdx = (sugIdx + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items.forEach((b, i) => b.classList.toggle("on", i === sugIdx));
  } else if (e.key === "Enter") {
    e.preventDefault();
    if (sugIdx >= 0 && items[sugIdx]) location.hash = items[sugIdx].dataset.sug;
    else { state.q = qEl.value.trim(); if (["", "catalog", "new"].includes(parseHash().parts[0] || "")) rerender(); else location.hash = "#/?q=" + encodeURIComponent(state.q); }
    hideSuggest(); qEl.blur();
  } else if (e.key === "Escape") hideSuggest();
});
document.addEventListener("click", e => { if (!e.target.closest(".searchbox")) hideSuggest(); });

// тема
const applyTheme = t => t ? document.documentElement.setAttribute("data-theme", t) : document.documentElement.removeAttribute("data-theme");
applyTheme(store.get("theme", null));
$("#theme").onclick = () => {
  const dark = document.documentElement.dataset.theme ? document.documentElement.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  const t = dark ? "light" : "dark"; store.set("theme", t); applyTheme(t);
};

// города
$("#city").innerHTML = Object.keys(CITY_ZONE).sort((a, b) => a.localeCompare(b)).map(c => `<option ${c === state.city ? "selected" : ""}>${c}</option>`).join("");

window.addEventListener("hashchange", () => { route(); if (parseHash().parts[0] === "lot") scrollTo(0, 0); });

fetch("data/catalog.json", { cache: "no-cache" })
  .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
  .then(cat => {
    prepare(cat);
    const g = new Date(cat.meta.generated);
    $("#meta").textContent = `Обновлено ${g.toLocaleString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })} · ${cat.meta.products} позиций`;
    route();
  })
  .catch(() => { $("#app").innerHTML = `<div class="empty"><h2>Каталог ещё не собран</h2>Запустите <code>python -m scraper.run</code>, чтобы выгрузить данные обжарщиков.</div>`; });
})();
