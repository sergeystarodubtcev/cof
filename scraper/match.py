"""Склейка «одного и того же кофе» у разных обжарщиков.

Два уровня:
  lot    — конкретный лот: страна + регион + «имя» (станция мойки / ферма / кооператив / производитель)
           + совместимая обработка. «Ethiopia Konga Natural» = «Эфиопия Конга натуральная».
  origin — шире: страна + регион + обработка. Для блока «похожие лоты».
"""
from __future__ import annotations

import hashlib
import re

from rapidfuzz import fuzz

from .normalize import COUNTRIES, PROCESSES, REGIONS, VARIETIES, fold

TRANSLIT = str.maketrans({
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ж": "zh", "з": "z", "и": "i", "й": "i",
    "к": "k", "л": "l", "м": "m", "н": "n", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t", "у": "u",
    "ф": "f", "х": "h", "ц": "c", "ч": "ch", "ш": "sh", "щ": "sh", "ъ": "", "ы": "y", "ь": "", "э": "e",
    "ю": "yu", "я": "ya",
})

STOP = set("""
кофе coffee зерно зернах в зернах молотый арабика arabica моносорт single origin specialty спешелти спешалти
для под фильтр filter эспрессо espresso омни omni обжарка обжарки roast light medium dark светлая средняя
темная lot лот микролот microlot г гр кг g kg шт new новинка новый limited лимитированный the de la el del
и and с with of выпуск сезон season урожай crop grade gr1 gr2 g1 g2 g3 aa ab pb plus top ааа ааа
процесс process обработка обработки сорт сорта variety varietal регион region ферма farm finca fazenda
станция washing station мойки cooperative кооператив производитель producer
""".split())


def latin(s: str) -> str:
    s = fold(s).translate(TRANSLIT)
    # фонетические упрощения, чтобы «Ирга-чеффе» ≈ «Yirgacheffe»
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    s = re.sub(r"\by(?=[aeiou])", "", s)
    for a, b in (("ff", "f"), ("ch", "c"), ("sh", "s"), ("kh", "h"), ("ph", "f"), ("w", "v"), ("j", "dz"), ("q", "k"), ("x", "ks"),
                 ("ee", "i"), ("y", "i"), ("ll", "l"), ("tt", "t"), ("rr", "r"), ("ss", "s"), ("nn", "n")):
        s = s.replace(a, b)
    return re.sub(r"\s+", " ", s).strip()


def _all_vocab() -> list[str]:
    # регионы вычитаются отдельно и только найденный — иначе пропадают названия станций/ферм
    words = []
    for syns in COUNTRIES.values():
        words += syns
    for _, syns in PROCESSES:
        words += syns
    for syns in VARIETIES.values():
        words += syns
    return [latin(w) for w in words if len(w) > 2]


_VOCAB = None


def identity_tokens(name: str, country: str | None = None, region: str | None = None) -> list[str]:
    """Значимые слова названия, после вычитания страны/региона/обработки/сорта и шума."""
    global _VOCAB
    _VOCAB = _VOCAB or _all_vocab()
    vocab = _VOCAB + [latin(w) for w in REGIONS.get(country or "", {}).get(region or "", [])]
    s = re.sub(r"\d+\s*(г|гр|кг|g|kg)\b", " ", fold(name))
    s = re.sub(r"[«»\"'()\[\],.:;/|+–—-]", " ", s)
    toks = []
    for t in s.split():
        if t in STOP or len(t) < 3 or t.isdigit():
            continue
        lt = latin(t)
        if not lt or any(lt.startswith(v[:max(4, len(v) - 2)]) for v in vocab if len(v) >= 4) or lt in vocab:
            continue
        toks.append(lt)
    return toks


def _process_family(p: str | None) -> str | None:
    if p in ("Анаэробная", "Карбоническая мацерация", "Термошок", "Ферментация"):
        return "experimental"
    return p


def same_lot(a: dict, b: dict) -> bool:
    if a.get("is_blend") or b.get("is_blend"):
        return False
    if not a.get("country") or a.get("country") != b.get("country"):
        return False
    if a.get("region") and b.get("region") and a["region"] != b["region"]:
        return False
    pa, pb = _process_family(a.get("process")), _process_family(b.get("process"))
    if pa and pb and pa != pb:
        return False
    if a.get("is_decaf") != b.get("is_decaf"):
        return False
    ta, tb = " ".join(a["_id_tokens"]), " ".join(b["_id_tokens"])
    if ta and tb:
        return fuzz.token_set_ratio(ta, tb) >= 82
    # оба без «имени»: «Эфиопия Иргачеффе мытая» = такой же у другого обжарщика,
    # если совпадают регион и обработка (это сопоставимый тип лота)
    return not ta and not tb and bool(a.get("region")) and a.get("region") == b.get("region") and bool(pa) and pa == pb


def origin_key(p: dict) -> str:
    return "|".join([p.get("country") or "?", p.get("region") or "?", _process_family(p.get("process")) or "?"])


def cluster(products: list[dict]) -> dict[str, list[dict]]:
    for p in products:
        p["_id_tokens"] = identity_tokens(p["name"], p.get("country"), p.get("region"))
    groups: list[list[dict]] = []
    for p in sorted(products, key=lambda x: (x.get("country") or "", x["roaster"])):
        for g in groups:
            # не склеиваем два товара одного обжарщика (это обычно разные вкусы/обжарки)
            if any(q["roaster"] == p["roaster"] for q in g):
                continue
            if all(same_lot(p, q) for q in g[:3]):
                g.append(p)
                break
        else:
            groups.append([p])
    lots = {}
    for g in groups:
        head = max(g, key=lambda x: len(x["_id_tokens"]))
        key = "|".join([head.get("country") or "?", head.get("region") or "?",
                        " ".join(sorted(head["_id_tokens"])) or "-", _process_family(head.get("process")) or "?"])
        lid = hashlib.md5(key.encode()).hexdigest()[:10]
        while lid in lots:
            lid = hashlib.md5((lid + key).encode()).hexdigest()[:10]
        lots[lid] = g
        for p in g:
            p["lot"] = lid
            p["origin_key"] = origin_key(p)
            p.pop("_id_tokens", None)
    return lots
