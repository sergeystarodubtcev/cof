"""Адаптеры магазинов. Каждый возвращает список «сырых» товаров единого вида:

    {url, name, description, notes?, image, category?, available, variants: [{weight_g, price, available}]}

Порядок попыток: явная платформа из реестра → автоопределение → generic (sitemap + JSON-LD/OpenGraph).
Generic работает почти на любом сайте, поэтому новый лот появляется в каталоге
без ручной настройки, как только обжарщик опубликует его страницу.
"""
from __future__ import annotations

import html as htmllib
import json
import os
import re
from pathlib import Path
from urllib.parse import urljoin, urlparse

from bs4 import BeautifulSoup

from . import http
from .normalize import parse_weight_g

MAX_PAGES = 600  # потолок загружаемых страниц на одного обжарщика для generic


def _clean(s) -> str:
    if not s:
        return ""
    s = htmllib.unescape(str(s))
    if "<" in s:
        s = BeautifulSoup(s, "lxml").get_text("\n")
    return re.sub(r"[ \t\r\f\v]+", " ", re.sub(r"\n\s*\n+", "\n", s)).strip()


def _price(v) -> float | None:
    if v in (None, ""):
        return None
    try:
        return float(re.sub(r"[^\d.]", "", str(v).replace(",", ".")) or "nan")
    except ValueError:
        return None


# ═════════════════════════════ Shopify ═════════════════════════════
def shopify(site: str) -> list[dict] | None:
    out, page = [], 1
    while page <= 20:
        data = http.get_json(f"{site.rstrip('/')}/products.json?limit=250&page={page}")
        if not data or "products" not in data:
            return out or None
        if not data["products"]:
            break
        for p in data["products"]:
            variants = []
            for v in p.get("variants", []):
                label = " ".join(filter(None, [v.get("title"), v.get("option1"), v.get("option2")]))
                variants.append({
                    "weight_g": parse_weight_g(label) or (v.get("grams") or None),
                    "price": _price(v.get("price")),
                    "available": v.get("available", True),
                })
            img = (p.get("images") or [{}])[0].get("src")
            out.append({
                "url": f"{site.rstrip('/')}/products/{p['handle']}",
                "name": p.get("title", ""),
                "description": _clean(p.get("body_html")),
                "category": p.get("product_type", "") + " " + " ".join(p.get("tags", []) if isinstance(p.get("tags"), list) else [p.get("tags", "")]),
                "image": img,
                "available": any(v["available"] for v in variants) if variants else True,
                "variants": variants,
            })
        page += 1
    return out


# ═══════════════════════════ WooCommerce ═══════════════════════════
def woocommerce(site: str) -> list[dict] | None:
    base = f"{site.rstrip('/')}/wp-json/wc/store/v1/products"
    out, page = [], 1
    while page <= 30:
        data = http.get_json(f"{base}?per_page=100&page={page}")
        if not isinstance(data, list):
            return out or None
        if not data:
            break
        for p in data:
            prices = p.get("prices", {})
            minor = int(prices.get("currency_minor_unit", 2) or 0)
            div = 10 ** minor

            def money(x):
                v = _price(x)
                return v / div if v is not None else None

            variants = []
            for attr in p.get("attributes", []):
                for term in attr.get("terms", []):
                    w = parse_weight_g(term.get("name", ""))
                    if w:
                        variants.append({"weight_g": w, "price": None, "available": p.get("is_in_stock", True)})
            base_price = money(prices.get("price"))
            rng = prices.get("price_range") or {}
            if variants:
                # Store API не отдаёт цену каждой вариации без доп. запросов — берём их отдельно
                for var in p.get("variations", [])[:8]:
                    vd = http.get_json(f"{base}/{var['id']}")
                    if not vd:
                        continue
                    label = " ".join(a.get("value", "") for a in var.get("attributes", []))
                    w = parse_weight_g(label)
                    for v in variants:
                        if v["weight_g"] == w:
                            v["price"] = money(vd.get("prices", {}).get("price"))
                for v in variants:
                    if v["price"] is None and len(variants) == 1:
                        v["price"] = base_price
                variants = [v for v in variants if v["price"]] or [{"weight_g": None, "price": money(rng.get("min_amount")) or base_price, "available": p.get("is_in_stock", True)}]
            else:
                variants = [{"weight_g": parse_weight_g(p.get("name", "")), "price": base_price, "available": p.get("is_in_stock", True)}]
            out.append({
                "url": p.get("permalink"),
                "name": _clean(p.get("name")),
                "description": _clean(p.get("description") or p.get("short_description")),
                "category": " ".join(c.get("name", "") for c in p.get("categories", [])),
                "image": (p.get("images") or [{}])[0].get("src"),
                "available": p.get("is_in_stock", True),
                "variants": variants,
            })
        page += 1
    return out


# ═════════════════════════════ InSales ═════════════════════════════
def insales(site: str) -> list[dict] | None:
    out, page = [], 1
    while page <= 30:
        data = http.get_json(f"{site.rstrip('/')}/collection/all.json?page={page}&per_page=100")
        prods = (data or {}).get("products") if isinstance(data, dict) else data
        if not prods:
            break
        for p in prods:
            variants = [{
                "weight_g": parse_weight_g(v.get("title", "")) or (int(float(v["weight"]) * 1000) if v.get("weight") else None),
                "price": _price(v.get("price")),
                "available": v.get("available", True),
            } for v in p.get("variants", [])]
            img = (p.get("images") or p.get("first_image") and [p["first_image"]] or [{}])[0]
            out.append({
                "url": urljoin(site, p.get("url", "")),
                "name": p.get("title", ""),
                "description": _clean(p.get("description") or p.get("short_description")),
                "image": img.get("original_url") or img.get("large_url") or img.get("url"),
                "available": p.get("available", True),
                "variants": variants,
            })
        page += 1
    return out or None


# ═════════════════════════════ Tilda ═══════════════════════════════
TILDA_PART = re.compile(r"storepart(?:uid|s)?['\"]?\s*[:=]\s*['\"]([\d,]+)['\"]", re.I)
TILDA_REC = re.compile(r'id="rec(\d+)"[^>]*data-record-type="(?:1002|706|754|776|778|786|930|973|1025)"')


def tilda(site: str, pages: list[str]) -> list[dict] | None:
    parts, recid = set(), None
    for url in pages:
        html = http.get_text(url) or ""
        for m in TILDA_PART.finditer(html):
            parts.update(p for p in m.group(1).split(",") if p)
        recid = recid or (TILDA_REC.search(html).group(1) if TILDA_REC.search(html) else None)
    if not parts:
        return None
    out, seen = [], set()
    for part in parts:
        api = (f"https://store.tildacdn.com/api/getproductslist/?storepartuid={part}"
               f"&recid={recid or 0}&c=1&getparts=true&getoptions=true&slice=1&size=500")
        data = http.get_json(api, headers={"Referer": site})
        dump = os.environ.get("TILDA_DUMP")
        if dump and data:
            Path(dump).mkdir(parents=True, exist_ok=True)
            (Path(dump) / f"{urlparse(site).netloc}_{part}.json").write_text(json.dumps(data, ensure_ascii=False)[:400000])
        for p in (data or {}).get("products", []):
            if p.get("uid") in seen:
                continue
            seen.add(p.get("uid"))
            try:
                gallery = json.loads(p.get("gallery") or "[]")
            except ValueError:
                gallery = []
            variants = []
            for ed in p.get("editions", []) or []:
                opts = {k: str(v) for k, v in ed.items() if k not in ("uid", "price", "priceold", "sku", "quantity", "img", "externalid")}
                w = parse_weight_g(" ".join(opts.values()))
                if not w:  # «Вес»: «250» — число без единиц
                    for k, v in opts.items():
                        if re.search(r"вес|фасовк|упаков|объ[её]м|weight|size|граммов", k, re.I) and re.fullmatch(r"\s*\d+(?:[.,]\d+)?\s*", v):
                            x = float(v.replace(",", "."))
                            w = int(x * 1000) if x <= 5 else int(x)
                w = w or parse_weight_g(p.get("title", ""))
                variants.append({"weight_g": w, "price": _price(ed.get("price")),
                                 "available": str(ed.get("quantity", "")) not in ("0",)})
            if not variants:
                variants = [{"weight_g": parse_weight_g(p.get("title", "") + " " + (p.get("descr") or "")),
                             "price": _price(p.get("price")), "available": str(p.get("quantity", "")) != "0"}]
            out.append({
                "url": p.get("url") or site,
                "name": _clean(p.get("title")),
                "description": _clean(f"{p.get('descr', '')}\n{p.get('text', '')}"),
                "image": gallery[0].get("img") if gallery else None,
                "available": any(v["available"] for v in variants),
                "variants": variants,
            })
    return out or None


# ══════════════════ Generic: sitemap + обход разделов + разметка ═════════════════
PRODUCT_URL = re.compile(
    r"/(product|products|tproduct|catalog|shop|kofe|coffee|item|goods|tovar|p)/|/kofe-|/coffee-|-kofe|_kofe", re.I)
SKIP_URL = re.compile(r"\.(jpg|jpeg|png|webp|gif|pdf|svg|xml)$|/(blog|news|stat|article|tag|cart|basket|account|login|search|personal|auth|compare|favorite)", re.I)
# разделы, где точно не зёрна: не тратим на них бюджет обхода
NON_COFFEE_URL = re.compile(
    r"merch|aksessuar|accessor|arkhiv|archive|filtr[-_]?paket|drip|dripp|kapsul|capsul|ekstrakt|extract|napitk|v[-_]bankakh|"
    r"shokolad|chocolate|sertifikat|certificate|gift|podpisk|subscri|dlya[-_]yur|yur[-_]lits|opt/|wholesale|posuda|chay|/tea|oborudovan|"
    r"equipment|syrop|siroup|-old$|-old/", re.I)
LABELS = ["Страна", "Регион", "Провинция", "Ферма", "Производитель", "Фермер", "Станция", "Кооператив", "Разновидность", "Сорт",
          "Сорта", "Способ обработки", "Обработка", "Высота произрастания", "Высота", "Степень обжарки", "Обжарка", "Сбор урожая",
          "Урожай", "Дескрипторы", "Вкусовой профиль", "Вкус", "Профиль", "Оценка", "Оценка SCA", "Q-grade"]
_LABEL_RE = re.compile(r"(?<![\w-])(" + "|".join(sorted(map(re.escape, LABELS), key=len, reverse=True)) + r")\s*[:—–-]?\s+", re.I)


def _sitemap_urls(site: str) -> list[str]:
    roots = []
    robots = http.get_text(urljoin(site, "/robots.txt")) or ""
    roots += re.findall(r"(?im)^sitemap:\s*(\S+)", robots)
    roots += [urljoin(site, "/sitemap.xml"), urljoin(site, "/sitemap_index.xml")]
    urls, seen, queue = [], set(), list(dict.fromkeys(roots))
    while queue and len(seen) < 40:
        sm = queue.pop(0)
        if sm in seen:
            continue
        seen.add(sm)
        xml = http.get_text(sm) or ""
        for loc in re.findall(r"<loc>\s*([^<\s]+)\s*</loc>", xml):
            loc = htmllib.unescape(loc)
            if loc.endswith((".xml", ".xml.gz")):
                (queue.insert(0, loc) if re.search(r"product|tovar|goods|shop|catalog", loc, re.I) else queue.append(loc))
            else:
                urls.append(loc)
    return urls


def _internal_links(url: str, soup: BeautifulSoup, host: str) -> list[str]:
    out = []
    for a in soup.select("a[href]"):
        href = a["href"].strip()
        if href.startswith(("javascript:", "mailto:", "tel:")):
            continue
        u = urljoin(url, href.split("#")[0])
        pu = urlparse(u)
        if pu.netloc.replace("www.", "") != host or SKIP_URL.search(pu.path):
            continue
        # пагинация каталога — оставляем query, прочее отбрасываем
        if pu.query and not re.search(r"(PAGEN_\d+|page)=\d+", pu.query, re.I):
            u = u.split("?")[0]
        out.append(u)
    return out


def _jsonld_products(soup: BeautifulSoup) -> list[dict]:
    found = []

    def walk(o):
        if isinstance(o, list):
            for x in o:
                walk(x)
        elif isinstance(o, dict):
            t = o.get("@type")
            if t == "Product" or (isinstance(t, list) and "Product" in t):
                found.append(o)
            for k in ("@graph", "itemListElement", "item", "mainEntity"):
                if k in o:
                    walk(o[k])

    for tag in soup.select('script[type="application/ld+json"]'):
        try:
            walk(json.loads(tag.string or tag.get_text() or "null"))
        except (ValueError, TypeError):
            continue
    return found


def _offer_weight(o: dict) -> int | None:
    label = f"{o.get('name', '')} {o.get('sku', '')} {o.get('url', '')}"
    props = o.get("additionalProperty") or []
    for pr in props if isinstance(props, list) else [props]:
        if isinstance(pr, dict):
            label += f" {pr.get('value', '')}"
    m = re.search(r"/(\d{2,4})g/?$", str(o.get("url", "")))  # …/1000g
    return parse_weight_g(label) or (int(m.group(1)) if m else None)


def _microdata_offers(soup: BeautifulSoup) -> list[dict]:
    """Битрикс и др.: несколько Offer подряд в одном itemprop=offers — новый оффер начинается с sku/name."""
    out = []
    for box in soup.select('[itemprop="offers"]'):
        cur: dict = {}
        for el in box.find_all(attrs={"itemprop": True}):
            k = el["itemprop"]
            v = el.get("content") or el.get("href") or el.get_text(" ", strip=True)
            if k in ("sku", "name") and cur.get("price") is not None:
                out.append(cur)
                cur = {}
            cur[k if k != "name" else "sku"] = cur.get(k, "") + " " + v if k in ("sku", "name") else v
        if cur:
            out.append(cur)
    return [{"weight_g": parse_weight_g(o.get("sku", "")), "price": _price(o.get("price")),
             "available": "OutOfStock" not in str(o.get("availability", "")) and "PreOrder" not in str(o.get("availability", ""))}
            for o in out if _price(o.get("price"))]


def _page_weights(soup: BeautifulSoup) -> list[int]:
    sel = ("option, .tc-weight, [data-onevalue], [data-treevalue], .sku-props li, .variant, .js-product-edition-option, "
           "[class*=weight], [class*=fasov], [class*=pack] li, .product-variants label")
    ws = {parse_weight_g(e.get("title") or e.get_text(" ")) for e in soup.select(sel)}
    return sorted(w for w in ws if w and 50 <= w <= 3000)


def extract_specs(text: str) -> dict:
    """Характеристики из табличной вёрстки: строка-метка и значение следом
    («Регион» ⏎ «Каранави») или «Метка: значение» в одной строке. Прозу не трогаем."""
    labels = {l.lower(): l for l in LABELS}
    lines = [l.strip(" \t:") for l in text.split("\n")]
    lines = [l for l in lines if l]
    specs = {}
    for i, line in enumerate(lines):
        low = line.lower()
        key = val = None
        if low in labels and i + 1 < len(lines):
            key, val = labels[low], lines[i + 1]
        else:
            m = re.match(r"(" + "|".join(sorted(map(re.escape, LABELS), key=len, reverse=True)) + r")\s*:\s*(.+)$", line, re.I)
            if m:
                key, val = labels.get(m.group(1).lower(), m.group(1)), m.group(2)
        prose = key in ("Вкус", "Вкусовой профиль", "Профиль", "Оценка", "Оценка sca") and not re.search(r"[,\d]", val)
        if key and val and not prose and val.lower() not in labels and 1 < len(val) <= 80 and key not in specs:
            specs[key] = val.strip(" .;")
    return specs


def _gallery(url: str, html: str) -> list[str]:
    """Актуальная галерея товара из данных страницы (SPA часто кладут её в JSON состояния, а не в разметку).
    Берём картинки, в имени файла которых есть слаг товара; свежие (с меткой времени) и ~768–1024px — первыми."""
    slug = urlparse(url).path.rstrip("/").split("/")[-1].lower()
    if len(slug) < 4:
        return []
    h = html.replace("\\u002F", "/").replace("\\/", "/")
    cands = dict.fromkeys(re.findall(r"https?://[^\"'\s<>()]+?\.(?:webp|jpe?g|png)", h, re.I))
    hits = [c for c in cands if slug in c.lower().rsplit("/", 1)[-1]]

    def score(c):
        name = c.rsplit("/", 1)[-1]
        return (bool(re.match(r"\d{9,}", name)), bool(re.search(r"-(?:7\d\d|8\d\d|10\d\d)\.", name)), name.endswith(".webp"))
    hits.sort(key=score, reverse=True)
    if hits and score(hits[0])[0]:
        hits = [c for c in hits if score(c)[0]]  # есть свежие — устаревшие файлы отбрасываем
    out, bases = [], set()
    for c in hits:
        base = re.sub(r"-(?:\d{2,4}|full)\.(webp|jpe?g|png)$", "", c)
        if base not in bases:
            bases.add(base)
            out.append(c)
    return out[:5] if hits and score(hits[0])[0] else []


def parse_product_page(url: str, html: str) -> dict | None:
    soup = BeautifulSoup(html, "lxml")
    meta = lambda *names: next((m.get("content") for n in names for m in soup.select(f'meta[property="{n}"], meta[name="{n}"]') if m.get("content")), None)  # noqa: E731
    prods = _jsonld_products(soup)
    agg = None
    variants: list[dict] = []
    name = desc = img = None
    if prods:
        p = prods[0]
        offers = p.get("offers") or {}
        offers = offers if isinstance(offers, list) else [offers]
        flat = []
        for o in offers:
            if o.get("@type") == "AggregateOffer":
                agg = o
                flat += o.get("offers") or []
            else:
                flat.append(o)
        variants = [{"weight_g": _offer_weight(o), "price": _price(o.get("price") or (o.get("priceSpecification") or {}).get("price")),
                     "available": "OutOfStock" not in str(o.get("availability", ""))} for o in flat if o]
        img = p.get("image")
        if isinstance(img, list):
            img = img[0] if img else None
        if isinstance(img, dict):
            img = img.get("url") or img.get("contentUrl")
        name, desc = _clean(p.get("name")), _clean(p.get("description"))
    micro = _microdata_offers(soup)
    # микроразметка побеждает, если в ней есть фасовки, а в JSON-LD нет
    if micro and (not any(v["price"] for v in variants)
                  or (any(v["weight_g"] for v in micro) and not any(v["weight_g"] for v in variants))):
        variants = micro
    if not name:
        md = soup.select_one('[itemtype*="schema.org/Product"] [itemprop="name"]')
        h1 = soup.select_one("h1")
        name = _clean((md and (md.get("content") or md.get_text())) or meta("og:title") or (h1 and h1.get_text()) or "")
    if not img:
        mi = soup.select_one('[itemtype*="schema.org/Product"] [itemprop="image"]')
        img = meta("og:image") or (mi and (mi.get("content") or mi.get("href") or mi.get("src")))
        if img and urlparse(urljoin(url, img)).path in ("", "/"):
            img = None
    if not variants:
        if not (prods or micro or meta("product:price:amount") or soup.select_one('[itemtype*="schema.org/Product"]')
                or (meta("og:type") or "").lower() in ("product", "og:product", "product.item")):
            return None
        price = meta("product:price:amount") or (soup.select_one('[itemprop="price"]') or {}).get("content")
        lo = agg and agg.get("lowPrice")
        variants = [{"weight_g": None, "price": _price(price or lo), "available": "out" not in (meta("product:availability") or "").lower()}]
    desc = desc or _clean(meta("og:description", "description"))

    # Описание и характеристики со страницы
    body = soup.select_one('[itemprop="description"], .product-description, .product__description, .t-store__prod-popup__text, '
                           '.woocommerce-product-details__short-description, .detail-text, .catalog-element-description, '
                           '.detail_text, .product-detail-text, [class*=description]')
    if body:
        full = _clean(str(body))
        if len(full) > len(desc or ""):
            desc = full
    page_text = re.sub(r"[ \t]+", " ", soup.get_text("\n"))
    specs = extract_specs(page_text)

    # Фасовки
    weights = _page_weights(soup)
    for v in variants:
        v["weight_g"] = v["weight_g"] or (parse_weight_g(name) if len(variants) == 1 else None)
    if len(variants) == 1 and not variants[0]["weight_g"]:
        if agg and len(weights) >= 2 and _price(agg.get("lowPrice")) and _price(agg.get("highPrice")):
            # AggregateOffer без офферов (Битрикс/Aspro): мин. цена ↔ мин. фасовка, макс. ↔ макс.
            a = variants[0]["available"]
            variants = [{"weight_g": weights[0], "price": _price(agg["lowPrice"]), "available": a},
                        {"weight_g": weights[-1], "price": _price(agg["highPrice"]), "available": a}]
        elif len(weights) == 1:
            variants[0]["weight_g"] = weights[0]
    elif len(variants) > 1 and not any(v["weight_g"] for v in variants) and len(weights) == len(variants):
        # офферы без подписи веса, но фасовок на странице столько же: дешевле — меньше
        for v, w in zip(sorted(variants, key=lambda v: v["price"] or 0), weights):
            v["weight_g"] = w
    # Битрикс: флаг CAN_BUY у торговых предложений надёжнее, чем текст «Нет в наличии»
    can = re.findall(r'"CAN_BUY"\s*:\s*"?(\w+)', html)
    if can:
        buy = any(c in ("1", "true", "Y") for c in can)
        for v in variants:
            v["available"] = buy
    if not name or not any(v["price"] for v in variants):
        return None
    gallery = _gallery(url, html)
    if gallery:
        img = gallery[0]
    crumbs = " / ".join(e.get_text(" ", strip=True) for e in soup.select('[itemtype*="BreadcrumbList"] [itemprop="name"], .breadcrumbs a, .breadcrumb a'))
    return {"url": url, "name": name, "description": desc or "", "image": urljoin(url, img) if img else None,
            "category": crumbs, "specs": specs, "gallery": gallery[1:4], "available": any(v["available"] for v in variants), "variants": variants}


def generic(site: str, start_pages: list[str], budget: int = MAX_PAGES) -> list[dict]:
    """Обход: карта сайта + разделы каталога (BFS). Страница с разметкой товара — товар, иначе — источник ссылок."""
    host = urlparse(site).netloc.replace("www.", "")
    looks = lambda u: bool(PRODUCT_URL.search(urlparse(u).path)) and not NON_COFFEE_URL.search(u)  # noqa: E731
    coffee_first = lambda u: (0 if re.search(r"kofe|coffee|zern|кофе", u, re.I) else 1, u.count("/"))  # noqa: E731
    sm = [u for u in _sitemap_urls(site) if urlparse(u).netloc.replace("www.", "") == host and looks(u) and not SKIP_URL.search(u)]
    queue = list(dict.fromkeys([*start_pages, urljoin(site, "/catalog/"), *sorted(sm, key=coffee_first)]))
    seen, out, fetched = set(), [], 0
    while queue and fetched < budget:
        u = queue.pop(0)
        if u in seen:
            continue
        seen.add(u)
        html = http.get_text(u)
        fetched += 1
        if not html:
            continue
        item = parse_product_page(u, html)
        if item:
            out.append(item)
            continue
        # страница-раздел: добавляем ссылки на товары и подразделы, кофейные — в начало очереди
        links = [l for l in _internal_links(u, BeautifulSoup(html, "lxml"), host) if l not in seen and looks(l)]
        links = sorted(dict.fromkeys(links), key=coffee_first)
        front = [l for l in links if coffee_first(l)[0] == 0]
        queue = front + [q for q in queue if q not in front] + [l for l in links if l not in front]
    return out


# ═══════════════════════ Автоопределение ═══════════════════════════
def detect(site: str) -> tuple[str, str]:
    html = http.get_text(site) or ""
    low = html.lower()
    if "cdn.shopify.com" in low or "shopify.theme" in low:
        return "shopify", html
    if "wp-content" in low and ("woocommerce" in low or "wc-block" in low):
        return "woocommerce", html
    if "tildacdn" in low or "tilda.ws" in low:
        return "tilda", html
    if "insales" in low:
        return "insales", html
    if "ecwid" in low:
        return "ecwid", html
    if "bitrix" in low:
        return "bitrix", html
    return ("unknown" if html else "unreachable"), html


def scrape_site(roaster: dict) -> tuple[str, list[dict]]:
    site = roaster["site"]
    start = roaster.get("catalog") or [site]
    platform = roaster.get("platform")
    detected, _ = detect(site)
    if detected == "unreachable" and not platform:
        return "unreachable", []
    platform = platform or detected
    items = None
    if platform == "shopify":
        items = shopify(site)
    elif platform == "woocommerce":
        items = woocommerce(site)
    elif platform == "insales":
        items = insales(site)
    elif platform == "tilda":
        items = tilda(site, list(dict.fromkeys([site, *start])))
    if not items:  # универсальный путь — работает и как подстраховка
        items = generic(site, start)
        platform = f"{platform}+generic" if platform not in ("generic", "unknown") else "generic"
    return platform, items
