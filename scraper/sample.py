"""Образцы HTML для отладки разбора: главная, каталог и первые ссылки на товары.

    python -m scraper.sample roastberry,znak     → data/samples/<id>/*.html
"""
import json
import re
import sys
from pathlib import Path
from urllib.parse import urljoin, urlparse

import yaml
from bs4 import BeautifulSoup

from . import http

ROOT = Path(__file__).resolve().parent.parent
only = sys.argv[1].split(",") if len(sys.argv) > 1 and sys.argv[1] else []
roasters = [r for r in yaml.safe_load((ROOT / "roasters.yaml").read_text())["roasters"] if r["id"] in only]
for r in roasters:
    out = ROOT / "data" / "samples" / r["id"]
    out.mkdir(parents=True, exist_ok=True)
    pages = [r["site"], *(r.get("catalog") or [])]
    raw = ROOT / "data" / "raw" / f"{r['id']}.json"
    if raw.exists():
        pages += [i["url"] for i in json.loads(raw.read_text())["items"][:2]]
    home = http.get_text(r["site"]) or ""
    host = urlparse(r["site"]).netloc.replace("www.", "")
    links = []
    for a in BeautifulSoup(home, "lxml").select("a[href]"):
        u = urljoin(r["site"], a["href"])
        if urlparse(u).netloc.replace("www.", "") == host and re.search(r"catalog|shop|kofe|coffee|product|tproduct|zern|magazin|store", u, re.I):
            links.append(u.split("#")[0])
    pages += list(dict.fromkeys(links))[:5]
    for n, u in enumerate(list(dict.fromkeys(pages))[:7]):
        html = http.get_text(u) or ""
        (out / f"{n}.html").write_text(f"<!-- {u} -->\n" + html)
        print(r["id"], n, u, len(html))
    for extra in ("/robots.txt", "/sitemap.xml"):
        (out / extra.strip("/").replace(".", "_")).write_text(http.get_text(urljoin(r["site"], extra)) or "")
