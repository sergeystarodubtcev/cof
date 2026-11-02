"""Сохраняет образцы HTML карточек товаров для отладки разбора: data/samples/<roaster>/N.html"""
import json
import re
import sys
from pathlib import Path

from . import http

ROOT = Path(__file__).resolve().parent.parent
only = sys.argv[1].split(",") if len(sys.argv) > 1 else None
for raw in sorted((ROOT / "data" / "raw").glob("*.json")):
    rid = raw.stem
    if only and rid not in only:
        continue
    items = json.loads(raw.read_text())["items"]
    coffee = [i["url"] for i in items if re.search(r"kofe|coffee/", i["url"]) and not re.search(r"filtr|arkhiv|old", i["url"])]
    picks = coffee[:3] + [i["url"] for i in items if "arkhiv" in i["url"]][:1]
    out = ROOT / "data" / "samples" / rid
    out.mkdir(parents=True, exist_ok=True)
    for n, u in enumerate(picks):
        html = http.get_text(u) or ""
        (out / f"{n}.html").write_text(f"<!-- {u} -->\n" + html)
        print(rid, n, u, len(html))
