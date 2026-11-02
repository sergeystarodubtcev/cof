"""Адаптеры магазинов. Каждый возвращает список «сырых» товаров единого вида:

    {url, name, description, notes?, image, category?, available, variants: [{weight_g, price, available}]}

Порядок попыток: явная платформа из реестра → автоопределение → generic (sitemap + JSON-LD/OpenGraph).
Generic работает почти на любом сайте, поэтому новый лот появляется в каталоге
без ручной настройки, как только обжарщик опубликует его страницу.
"""
from __future__ import annotations

import html as htmllib
import json
import re
from urllib.parse import urljoin, urlparse

from bs4 import BeautifulSoup

from . import http
from .normalize import parse_weight_g

MAX_PAGES = 400  # потолок страниц товаров на одного обжарщика для generic


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
                label = " ".join(str(v) for k, v in ed.items() if k not in ("uid", "price", "priceold", "sku", "quantity", "img"))
                variants.append({"weight_g": parse_weight_g(label), "price": _price(ed.get("price")),
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


# ══════════════════ Generic: sitemap + JSON-LD / OG ═════════════════
PRODUCT_URL = re.compile(
    r"/(product|products|tproduct|catalog|shop|kofe|coffee|item|goods|tovar|p)/|/kofe-|/coffee-|-kofe|_kofe", re.I)
SKIP_URL = re.compile(r"\.(jpg|jpeg|png|webp|gif|pdf|svg)$|/(blog|news|stat|article|tag|cart|basket|account|login|search)", re.I)


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
        locs = re.findall(r"<loc>\s*([^<\s]+)\s*</loc>", xml)
        for loc in locs:
            loc = htmllib.unescape(loc)
            if loc.endswith(".xml") or "sitemap" in loc.lower() and loc.endswith((".xml", ".xml.gz")):
                # приоритет картам товаров
                (queue.insert(0, loc) if re.search(r"product|tovar|goods|shop", loc, re.I) else queue.append(loc))
            else:
                urls.append(loc)
    return urls


def _links_from(url: str, host: str) -> list[str]:
    html = http.get_text(url) or ""
    soup = BeautifulSoup(html, "lxml")
    out = []
    for a in soup.select("a[href]"):
        u = urljoin(url, a["href"].split("#")[0])
        if urlparse(u).netloc.replace("www.", "") == host and PRODUCT_URL.search(urlparse(u).path) and not SKIP_URL.search(u):
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


def parse_product_page(url: str, html: str) -> dict | None:
    soup = BeautifulSoup(html, "lxml")
    meta = lambda *names: next((m.get("content") for n in names for m in soup.select(f'meta[property="{n}"], meta[name="{n}"]') if m.get("content")), None)  # noqa: E731
    prods = _jsonld_products(soup)
    if prods:
        p = prods[0]
        offers = p.get("offers") or {}
        offers = offers if isinstance(offers, list) else [offers]
        flat = []
        for o in offers:
            if o.get("@type") == "AggregateOffer":
                flat += o.get("offers") or [{"price": o.get("lowPrice"), "availability": o.get("availability")}]
            else:
                flat.append(o)
        variants = [{
            "weight_g": parse_weight_g(f"{o.get('name', '')} {o.get('sku', '')}"),
            "price": _price(o.get("price") or (o.get("priceSpecification") or {}).get("price")),
            "available": "OutOfStock" not in str(o.get("availability", "")),
        } for o in flat if o]
        img = p.get("image")
        if isinstance(img, list):
            img = img[0] if img else None
        if isinstance(img, dict):
            img = img.get("url") or img.get("contentUrl")
        name = _clean(p.get("name"))
        desc = _clean(p.get("description"))
    else:
        if (meta("og:type") or "").lower() not in ("product", "og:product", "product.item") and not meta("product:price:amount"):
            # нет признаков товара — пробуем microdata
            if not soup.select_one('[itemtype*="schema.org/Product"]'):
                return None
        name = _clean(meta("og:title") or (soup.title.string if soup.title else ""))
        desc = _clean(meta("og:description", "description"))
        img = meta("og:image")
        price = meta("product:price:amount") or (soup.select_one('[itemprop="price"]') or {}).get("content")
        variants = [{"weight_g": None, "price": _price(price), "available": "out" not in (meta("product:availability") or "").lower()}]
    # Полное описание со страницы — там обычно регион, ферма, высота, дескрипторы
    body = soup.select_one('[itemprop="description"], .product-description, .product__description, .t-store__prod-popup__text, .woocommerce-product-details__short-description, .product-info, .detail-text, .catalog-element-description')
    if body:
        full = _clean(str(body))
        if len(full) > len(desc):
            desc = full
    # Веса из селекторов вариантов на странице
    weights = sorted({w for w in (parse_weight_g(o.get_text()) for o in soup.select("option, label, .variant, .js-product-edition-option")) if w})
    for v in variants:
        v["weight_g"] = v["weight_g"] or parse_weight_g(name)
    if len(variants) == 1 and not variants[0]["weight_g"] and len(weights) == 1:
        variants[0]["weight_g"] = weights[0]
    if not name or not any(v["price"] for v in variants):
        return None
    return {"url": url, "name": name, "description": desc, "image": urljoin(url, img) if img else None,
            "available": any(v["available"] for v in variants), "variants": variants}


def generic(site: str, start_pages: list[str]) -> list[dict]:
    host = urlparse(site).netloc.replace("www.", "")
    candidates = [u for u in _sitemap_urls(site) if PRODUCT_URL.search(urlparse(u).path) and not SKIP_URL.search(u)]
    for p in start_pages:
        candidates += _links_from(p, host)
    # кофе — вперёд
    candidates = list(dict.fromkeys(candidates))
    candidates.sort(key=lambda u: 0 if re.search(r"kofe|coffee|zern|кофе", u, re.I) else 1)
    out = []
    for u in candidates[:MAX_PAGES]:
        html = http.get_text(u)
        if not html:
            continue
        item = parse_product_page(u, html)
        if item:
            out.append(item)
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
