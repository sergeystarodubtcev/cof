"""Полный цикл обновления каталога.

    python -m scraper.run                 # все обжарщики
    python -m scraper.run --only tasty,tab
    python -m scraper.run --offline       # пересобрать каталог из data/raw без сети

Каждый запуск:
  1. обходит сайты (платформа определяется заново — если обжарщик сменил движок, ничего не ломается);
  2. если сайт временно недоступен — берёт его прошлую выгрузку, чтобы лоты не «исчезали»;
  3. нормализует, склеивает одинаковые лоты, скачивает и сжимает картинки;
  4. сливает с прошлым каталогом: first_seen / price_history / «новинка» / «пропал из продажи».
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path

import yaml
from PIL import Image

from . import http
from .adapters import scrape_site
from .match import cluster
from .normalize import enrich, is_coffee

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
SITE = ROOT / "site"
IMG = SITE / "img"
CATALOG = SITE / "data" / "catalog.json"
SEEN = ROOT / "data" / "seen.json"      # память о всех когда-либо виденных позициях (дата появления, цены)
CHANGES = ROOT / "data" / "changes.json"  # журнал: что добавилось/удалилось на каждой проверке
NEW_DAYS = 14
STALE_MAX_DAYS = 3      # прошлой выгрузке сайта, который не ответил, верим не дольше
SHRINK_GUARD = 0.5      # сайт вдруг отдал < 50% обычного каталога — считаем сбоем обхода


def now() -> datetime:
    return datetime.now(timezone.utc).replace(microsecond=0)


def pid(roaster: str, url: str) -> str:
    return hashlib.md5(f"{roaster}|{url.split('?')[0].rstrip('/')}".encode()).hexdigest()[:12]


# ───────────────────────────── scrape ─────────────────────────────
def scrape_one(r: dict) -> dict:
    t0 = time.time()
    try:
        platform, items = scrape_site(r)
        err = None
    except Exception as e:  # один сломанный сайт не должен ронять весь прогон
        platform, items, err = "error", [], f"{type(e).__name__}: {e}"
    status = {"id": r["id"], "platform": platform, "items": len(items), "seconds": round(time.time() - t0, 1),
              "ok": bool(items), "error": err, "at": now().isoformat()}
    raw_path = RAW / f"{r['id']}.json"
    if items and raw_path.exists():
        prev_n = len(json.loads(raw_path.read_text()).get("items", []))
        if prev_n >= 10 and len(items) < prev_n * SHRINK_GUARD:
            status.update(ok=False, error=f"подозрительно мало товаров: {len(items)} вместо ~{prev_n}, оставлены прошлые данные")
            items = []
    if items:
        raw_path.write_text(json.dumps({"status": status, "items": items}, ensure_ascii=False, indent=1))
    elif raw_path.exists():
        status["stale"] = True  # оставляем прошлую выгрузку
    print(f"  {r['id']:<14} {platform:<20} {len(items):>4} товаров  {status['seconds']}s {err or ''}", flush=True)
    return status


# ───────────────────────────── images ─────────────────────────────
def fetch_image(product: dict) -> None:
    src = product.get("image_src")
    if not src:
        return
    name = hashlib.md5(src.encode()).hexdigest()[:16] + ".webp"
    dest = IMG / name
    if not dest.exists():
        r = http.get(src, timeout=30)
        if r is None:
            return
        try:
            im = Image.open(io.BytesIO(r.content))
            im = im.convert("RGBA") if im.mode in ("P", "LA") else im
            if im.mode == "RGBA":
                bg = Image.new("RGB", im.size, (255, 255, 255))
                bg.paste(im, mask=im.split()[-1])
                im = bg
            im = im.convert("RGB")
            im.thumbnail((640, 640))
            im.save(dest, "WEBP", quality=80, method=5)
        except Exception:
            return
    product["image"] = f"img/{name}"


# ───────────────────────────── build ──────────────────────────────
def to_product(roaster: dict, raw: dict) -> dict | None:
    if not raw.get("url") or not raw.get("name"):
        return None
    if not is_coffee(raw["name"], raw.get("description", ""), raw.get("category", ""), raw["url"]):
        return None
    variants, seen_v = [], set()
    for v in raw.get("variants", []):
        key = (v.get("weight_g"), v.get("price"))
        # пачка зерна дешевле 150 ₽ или дороже 30 000 ₽ — это служебная цена или оборудование
        if v.get("price") and 150 <= v["price"] <= 30000 and key not in seen_v:
            seen_v.add(key)
            variants.append(v)
    if not variants:
        return None
    per100 = [v["price"] / v["weight_g"] * 100 for v in variants if v.get("weight_g")]
    # подстраховка от мусорных цен (оптовые 10 кг без веса и т.п.)
    per100 = [x for x in per100 if 15 <= x <= 20000]
    weights = sorted({v["weight_g"] for v in variants if v.get("weight_g")})
    p = {
        "id": pid(roaster["id"], raw["url"]),
        "roaster": roaster["id"],
        "name": raw["name"].strip(),
        "url": raw["url"],
        "image_src": raw.get("image"),
        "description": (raw.get("description") or "")[:1500],
        "notes": raw.get("notes"),
        "price_from": min(v["price"] for v in variants),
        "price_100g": round(min(per100), 1) if per100 else None,
        "variants": [{"w": v.get("weight_g"), "p": v["price"], "a": v.get("available", True)} for v in variants][:8],
        "weights": weights,
        "available": bool(raw.get("available", True)) and any(v.get("available", True) for v in variants),
        "specs": {k: v for k, v in (raw.get("specs") or {}).items()},
    }
    return enrich(p)


def merge_history(products: list[dict], seen: dict, ts: datetime) -> list[dict]:
    """Дата первого появления и история цен — из памяти seen.json, поэтому вернувшийся
    в продажу лот не считается новинкой, а его цены продолжают историю."""
    stamp = ts.isoformat()
    for p in products:
        old = seen.get(p["id"], {})
        p["first_seen"] = old.get("first_seen", stamp)
        p["last_seen"] = stamp
        hist = old.get("price_history", [])
        if not hist or hist[-1][1] != p["price_from"]:
            hist = (hist + [[stamp[:10], p["price_from"]]])[-30:]
        p["price_history"] = hist
        seen[p["id"]] = {"first_seen": p["first_seen"], "last_seen": stamp, "price_history": hist,
                         "roaster": p["roaster"], "name": p["name"], "url": p["url"], "available": p["available"]}
    return products


def build(roasters: list[dict], statuses: dict[str, dict], log_changes: bool = True) -> dict:
    ts = now()
    previous = json.loads(CATALOG.read_text()) if CATALOG.exists() else None
    products = []
    rmap = {r["id"]: r for r in roasters}
    for r in roasters:
        raw_path = RAW / f"{r['id']}.json"
        if not raw_path.exists():
            continue
        raw = json.loads(raw_path.read_text())
        at = raw.get("status", {}).get("at")
        if at and ts - datetime.fromisoformat(at) > timedelta(days=STALE_MAX_DAYS):
            statuses.setdefault(r["id"], {}).update(stale=True, expired=True)
            print(f"  {r['id']}: данные старше {STALE_MAX_DAYS} дн. — наличие не подтверждено, позиции скрыты", flush=True)
            continue
        seen, mine = set(), []
        for item in raw["items"]:
            p = to_product(r, item)
            if p and p["id"] not in seen:
                seen.add(p["id"])
                mine.append(p)
        # Если сайт отдаёт «нет в наличии» почти на всё (наличие зависит от города/сессии),
        # такому флагу верить нельзя: показываем «наличие уточняйте».
        if len(mine) >= 20 and sum(not p["available"] for p in mine) / len(mine) > 0.85:
            for p in mine:
                p["available"] = None
            r["_stock_unknown"] = True
        products.extend(mine)
        statuses.setdefault(r["id"], raw.get("status", {}))
    seen = json.loads(SEEN.read_text()) if SEEN.exists() else {}
    if not seen and previous:  # первый запуск с памятью: переносим даты появления из текущего каталога
        seen = {p["id"]: {"first_seen": p["first_seen"], "price_history": p.get("price_history", []), "roaster": p["roaster"]} for p in previous["products"]}
    # нет в наличии → позиция уходит из каталога (в памяти seen остаётся)
    out_of_stock = [p for p in products if p["available"] is False]
    for p in out_of_stock:
        if p["id"] in seen:
            seen[p["id"]]["available"] = False
    products = [p for p in products if p["available"] is not False]
    print(f"Кофейных товаров в продаже: {len(products)} (нет в наличии, скрыто: {len(out_of_stock)}); скачиваю картинки…", flush=True)
    IMG.mkdir(parents=True, exist_ok=True)
    with ThreadPoolExecutor(12) as ex:
        list(ex.map(fetch_image, products))
    for p in products:
        p.pop("image_src", None)
    products = merge_history(products, seen, ts)
    cluster(products)

    first_run = (previous or {}).get("meta", {}).get("first_run", ts.isoformat())
    # журнал изменений относительно прошлой проверки
    prev_ids = {p["id"]: p for p in (previous or {}).get("products", []) if not p.get("gone")}
    cur_ids = {p["id"] for p in products}
    oos_ids = {p["id"] for p in out_of_stock}
    change = {"at": ts.isoformat(),
              "added": [{"id": p["id"], "roaster": p["roaster"], "name": p["name"], "url": p["url"], "back": p["first_seen"] != ts.isoformat()}
                        for p in products if p["id"] not in prev_ids],
              "removed": [{"id": i, "roaster": o["roaster"], "name": o["name"], "url": o["url"],
                           "reason": "нет в наличии" if i in oos_ids else "пропал с сайта"}
                          for i, o in prev_ids.items() if i not in cur_ids]}
    if log_changes:  # пересборка без сети (--offline) — не проверка наличия, в журнал не пишем
        log = json.loads(CHANGES.read_text()) if CHANGES.exists() else []
        log = (log + [change])[-90:]
        CHANGES.write_text(json.dumps(log, ensure_ascii=False, indent=1))
    SEEN.write_text(json.dumps(seen, ensure_ascii=False, separators=(",", ":")))
    print(f"Изменения: +{len(change['added'])} добавлено, −{len(change['removed'])} удалено", flush=True)
    # «Новинка» — только то, что появилось у обжарщика, которого мы уже отслеживали:
    # весь каталог только что подключённого обжарщика новинкой не считается
    roaster_start = {}
    for v in seen.values():
        if v.get("roaster") and v.get("first_seen"):
            roaster_start[v["roaster"]] = min(roaster_start.get(v["roaster"], v["first_seen"]), v["first_seen"])
    for p in products:
        start = datetime.fromisoformat(roaster_start.get(p["roaster"], p["first_seen"]))
        fs = datetime.fromisoformat(p["first_seen"])
        p["is_new"] = fs - start > timedelta(hours=20) and ts - fs < timedelta(days=NEW_DAYS)

    lots = {}
    for p in products:
        lots.setdefault(p["lot"], []).append(p["id"])
    roaster_out = []
    for r in roasters:
        st = statuses.get(r["id"], {})
        roaster_out.append({
            "id": r["id"], "name": r["name"], "city": r["city"], "site": r["site"],
            "roast": r.get("roast"), "roast_lag": r.get("roast_lag", 1), "delivery": r.get("delivery") or {},
            "award": r.get("award"), "platform": st.get("platform"), "ok": st.get("ok", False),
            "stale": st.get("stale", False), "checked_at": st.get("at"), "stock_unknown": r.get("_stock_unknown", False),
            "count": sum(1 for p in products if p["roaster"] == r["id"]),
            "error": st.get("error"), "expired": st.get("expired", False),
        })
    catalog = {
        "meta": {"generated": ts.isoformat(), "first_run": first_run, "products": len(products),
                 "lots_multi": sum(1 for v in lots.values() if len({next(p['roaster'] for p in products if p['id'] == i) for i in v}) > 1)},
        "roasters": roaster_out,
        "products": sorted(products, key=lambda p: (p["available"] is False, p["roaster"], p["name"])),
    }
    used = {p["image"].split("/")[-1] for p in products if p.get("image")}
    for f in IMG.glob("*.webp"):  # картинки снятых/отсеянных товаров больше не нужны
        if f.name not in used:
            f.unlink()
    CATALOG.parent.mkdir(parents=True, exist_ok=True)
    CATALOG.write_text(json.dumps(catalog, ensure_ascii=False, separators=(",", ":")))
    write_report(catalog, change)
    return catalog


def write_report(cat: dict, change: dict | None = None) -> None:
    new = [p for p in cat["products"] if p.get("is_new")]
    lines = [f"# Обновление каталога {cat['meta']['generated']}", "",
             f"Товаров: {cat['meta']['products']}, лотов у ≥2 обжарщиков: {cat['meta']['lots_multi']}", "",
             "## Обжарщики", "", "| Обжарщик | Платформа | Товаров | Статус |", "|---|---|---|---|"]
    for r in cat["roasters"]:
        st = "ok" if r["ok"] else ("скрыт: данные устарели" if r.get("expired") else "старые данные" if r["stale"] else "нет данных")
        lines.append(f"| {r['name']} | {r['platform'] or '—'} | {r['count']} | {st}{' — ' + r['error'] if r.get('error') else ''} |")
    lines += ["", f"## Новые лоты ({len(new)})", ""]
    rn = {r["id"]: r["name"] for r in cat["roasters"]}
    lines += [f"- **{rn[p['roaster']]}** — [{p['name']}]({p['url']}) — от {p['price_from']:.0f} ₽" for p in new[:200]]
    if change:
        rn2 = {r["id"]: r["name"] for r in cat["roasters"]}
        lines += ["", f"## Изменения этой проверки: +{len(change['added'])} / −{len(change['removed'])}", ""]
        lines += [f"- ➕ **{rn2.get(x['roaster'], x['roaster'])}** — [{x['name']}]({x['url']}){' (снова в продаже)' if x['back'] else ''}" for x in change["added"][:150]]
        lines += [f"- ➖ **{rn2.get(x['roaster'], x['roaster'])}** — {x['name']} ({x['reason']})" for x in change["removed"][:150]]
    (ROOT / "data" / "report.md").write_text("\n".join(lines) + "\n")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="id обжарщиков через запятую")
    ap.add_argument("--offline", action="store_true", help="не ходить в сеть, пересобрать из data/raw")
    ap.add_argument("--workers", type=int, default=8)
    a = ap.parse_args()
    roasters = yaml.safe_load((ROOT / "roasters.yaml").read_text())["roasters"]
    RAW.mkdir(parents=True, exist_ok=True)
    statuses: dict[str, dict] = {}
    if not a.offline:
        todo = [r for r in roasters if not a.only or r["id"] in a.only.split(",")]
        print(f"Обхожу {len(todo)} обжарщиков…", flush=True)
        with ThreadPoolExecutor(a.workers) as ex:
            for st in ex.map(scrape_one, todo):
                statuses[st["id"]] = st
    cat = build(roasters, statuses, log_changes=not a.offline)
    print(f"Готово: {cat['meta']['products']} товаров, {cat['meta']['lots_multi']} лотов есть у нескольких обжарщиков → {CATALOG}")
    if not any(r["ok"] or r["stale"] for r in cat["roasters"]):
        sys.exit("Ни один сайт не ответил — проверьте сетевой доступ.")


if __name__ == "__main__":
    main()
