"""Вежливый HTTP-клиент: ретраи, пауза между запросами к одному хосту, честный User-Agent."""
from __future__ import annotations

import os
import threading
import time
from urllib.parse import urlparse

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

UA = os.environ.get(
    "SCRAPER_UA",
    "Mozilla/5.0 (compatible; CoffeeCompareBot/1.0; +https://github.com/) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
)
DELAY = float(os.environ.get("SCRAPER_DELAY", "0.6"))

_session = requests.Session()
_retry = Retry(total=3, backoff_factor=1.0, status_forcelist=(429, 500, 502, 503, 504), allowed_methods=("GET", "HEAD"))
_session.mount("https://", HTTPAdapter(max_retries=_retry, pool_maxsize=32))
_session.mount("http://", HTTPAdapter(max_retries=_retry, pool_maxsize=32))
_session.headers.update({"User-Agent": UA, "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.6"})
if os.environ.get("REQUESTS_CA_BUNDLE") is None and os.path.exists("/root/.ccr/ca-bundle.crt"):
    _session.verify = "/root/.ccr/ca-bundle.crt"

_last: dict[str, float] = {}
_lock = threading.Lock()


def _throttle(url: str) -> None:
    host = urlparse(url).netloc
    with _lock:
        wait = _last.get(host, 0) + DELAY - time.monotonic()
        _last[host] = max(time.monotonic(), _last.get(host, 0) + DELAY)
    if wait > 0:
        time.sleep(wait)


def get(url: str, *, timeout: float = 25, **kw) -> requests.Response | None:
    _throttle(url)
    try:
        r = _session.get(url, timeout=timeout, **kw)
    except requests.RequestException:
        return None
    return r if r.status_code < 400 else None


def get_json(url: str, **kw):
    r = get(url, headers={"Accept": "application/json"}, **kw)
    if r is None:
        return None
    try:
        return r.json()
    except ValueError:
        return None


def get_text(url: str, **kw) -> str | None:
    r = get(url, **kw)
    if r is None:
        return None
    if not r.encoding or r.encoding.lower() == "iso-8859-1":
        r.encoding = r.apparent_encoding
    return r.text
