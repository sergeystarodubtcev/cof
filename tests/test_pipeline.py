"""Тесты разбора форматов магазинов и склейки лотов (без сети: http подменяется)."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scraper import adapters, http  # noqa: E402
from scraper.match import cluster  # noqa: E402
from scraper.normalize import enrich, is_coffee, parse_weight_g  # noqa: E402


def fake(routes):
    def get_json(url, **kw):
        for k, v in routes.items():
            if k in url:
                return v() if callable(v) else v
        return None

    def get_text(url, **kw):
        v = get_json(url)
        return v if isinstance(v, str) else None
    http.get_json, http.get_text = get_json, get_text
    adapters.http.get_json, adapters.http.get_text = get_json, get_text


def test_shopify():
    fake({"products.json?limit=250&page=1": {"products": [{
        "handle": "kenya-nyeri", "title": "Kenya Nyeri Gatomboya AA", "body_html": "<p>Tasting notes: blackcurrant, grapefruit</p>",
        "product_type": "Coffee", "tags": ["filter"], "images": [{"src": "https://cdn/x.jpg"}],
        "variants": [{"title": "250g", "price": "1450.00", "available": True}, {"title": "1kg", "price": "4900.00", "available": False}]}]},
        "page=2": {"products": []}})
    items = adapters.shopify("https://ex.com")
    assert items[0]["variants"][0] == {"weight_g": 250, "price": 1450.0, "available": True}
    assert items[0]["variants"][1]["weight_g"] == 1000
    assert items[0]["url"] == "https://ex.com/products/kenya-nyeri"


def test_woocommerce():
    fake({"products?per_page=100&page=1": [{
        "name": "Эфиопия Гуджи Ханса", "permalink": "https://ex.com/p/guji", "description": "<p>Дескрипторы: персик, жасмин</p>",
        "prices": {"price": "120000", "currency_minor_unit": 2}, "is_in_stock": True, "attributes": [], "categories": [{"name": "Кофе"}],
        "images": [{"src": "https://ex.com/g.jpg"}]}], "page=2": []})
    it = adapters.woocommerce("https://ex.com")[0]
    assert it["variants"][0]["price"] == 1200.0


def test_tilda():
    html = '<div id="rec123" data-record-type="1002"></div><script>t_store_init({storepart:"98765"})</script>'
    fake({"https://ex.com/shop": html, "https://ex.com": html,
          "getproductslist": {"products": [{"uid": "1", "title": "Колумбия Уила Эль Парайсо", "descr": "Гейша, анаэробная",
                                            "text": "Высота 1900 м", "price": "2100", "url": "https://ex.com/tproduct/1",
                                            "gallery": json.dumps([{"img": "https://static.tildacdn.com/a.jpg"}]),
                                            "editions": [{"uid": "e1", "price": "2100", "Вес": "200 г", "quantity": ""}]}]}})
    items = adapters.tilda("https://ex.com", ["https://ex.com/shop"])
    assert items[0]["image"].endswith("a.jpg") and items[0]["variants"][0]["weight_g"] == 200


def test_jsonld_page():
    html = """<html><head><script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Product",
      "name":"Бразилия Серрадо 250 г","image":["https://ex.com/b.png"],"description":"Натуральная. Ноты: какао, орех",
      "offers":{"@type":"AggregateOffer","lowPrice":"690","offers":[{"@type":"Offer","name":"250 г","price":"690","availability":"https://schema.org/InStock"},
      {"@type":"Offer","name":"1 кг","price":"2300","availability":"https://schema.org/OutOfStock"}]}}]}</script></head></html>"""
    it = adapters.parse_product_page("https://ex.com/catalog/brazil", html)
    assert [v["weight_g"] for v in it["variants"]] == [250, 1000]
    assert it["variants"][1]["available"] is False


def test_og_fallback():
    html = """<meta property="og:type" content="product"><meta property="og:title" content="Руанда Хуйе мытая">
    <meta property="og:image" content="/img/r.jpg"><meta property="product:price:amount" content="990">"""
    it = adapters.parse_product_page("https://ex.com/product/rw", html)
    assert it["image"] == "https://ex.com/img/r.jpg" and it["variants"][0]["price"] == 990


def test_filters():
    assert not is_coffee("Воронка Hario V60")
    assert not is_coffee("Дрип-пакеты Эфиопия 10 шт")
    assert is_coffee("Эфиопия Сидамо Бенса")
    assert parse_weight_g("1 кг") == 1000 and parse_weight_g("0,5кг") == 500


def test_clustering():
    names = [("a", "Эфиопия Иргачеффе Конга натуральная"), ("b", "Ethiopia Yirgacheffe Konga Natural"),
             ("c", "Эфиопия Иргачеффе Чельбеса натуральная"), ("a", "Колумбия Уила Эль Парайсо Гейша анаэробная"),
             ("b", "Colombia Huila El Paraiso Geisha Anaerobic"), ("c", "Колумбия Каука Эль Парайсо"),
             ("d", "Кения Ньери Гатомбойя АА мытая"), ("e", "Kenya Nyeri Gatomboya AA washed"), ("e", "Kenya Kirinyaga Kii AB")]
    ps = [enrich({"roaster": r, "name": n, "description": ""}) for r, n in names]
    cluster(ps)
    lot = [p["lot"] for p in ps]
    assert lot[0] == lot[1] != lot[2]
    assert lot[3] == lot[4] != lot[5]
    assert lot[6] == lot[7] != lot[8]


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
