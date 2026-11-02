"""Быстрая диагностика: какие сайты обжарщиков отвечают и на какой они платформе.

    python -m scraper.probe            → печатает таблицу и пишет data/probe.md
"""
from __future__ import annotations

import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import requests
import yaml

from . import http
from .adapters import detect

ROOT = Path(__file__).resolve().parent.parent


def probe(r: dict) -> dict:
    t0 = time.time()
    try:
        resp = requests.get(r["site"], timeout=20, headers={"User-Agent": http.UA}, allow_redirects=True)
        code, final = resp.status_code, resp.url
    except requests.RequestException as e:
        code, final = f"ERR {type(e).__name__}", ""
    platform = detect(r["site"])[0] if isinstance(code, int) and code < 400 else "—"
    return {"id": r["id"], "name": r["name"], "site": r["site"], "code": code, "final": final,
            "platform": platform, "sec": round(time.time() - t0, 1)}


def main() -> None:
    roasters = yaml.safe_load((ROOT / "roasters.yaml").read_text())["roasters"]
    with ThreadPoolExecutor(12) as ex:
        res = list(ex.map(probe, roasters))
    ok = [x for x in res if isinstance(x["code"], int) and x["code"] < 400]
    lines = [f"# Доступность сайтов ({len(ok)}/{len(res)} отвечают)", "",
             "| Обжарщик | Сайт | Ответ | Платформа | Редирект | с |", "|---|---|---|---|---|---|"]
    for x in res:
        redirect = x["final"] if x["final"] and x["final"].rstrip("/") != x["site"].rstrip("/") else ""
        lines.append(f"| {x['name']} | {x['site']} | {x['code']} | {x['platform']} | {redirect} | {x['sec']} |")
    text = "\n".join(lines) + "\n"
    (ROOT / "data").mkdir(exist_ok=True)
    (ROOT / "data" / "probe.md").write_text(text)
    print(text)


if __name__ == "__main__":
    main()
