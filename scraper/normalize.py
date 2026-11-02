"""Извлечение структурированных атрибутов кофе из названия и описания.

Всё работает на словарях синонимов RU/EN: новый лот с незнакомым названием всё равно
получит страну/обработку/сорт, если они упомянуты в тексте.
"""
from __future__ import annotations

import re
import unicodedata

# ── Страны ──────────────────────────────────────────────────────────────
COUNTRIES = {
    "Эфиопия": ["эфиопия", "ethiopia", "эфиоп"],
    "Кения": ["кения", "kenya"],
    "Колумбия": ["колумбия", "colombia"],
    "Бразилия": ["бразилия", "brazil", "brasil"],
    "Гватемала": ["гватемала", "guatemala"],
    "Коста-Рика": ["коста-рика", "коста рика", "costa rica"],
    "Гондурас": ["гондурас", "honduras"],
    "Сальвадор": ["сальвадор", "el salvador", "salvador"],
    "Никарагуа": ["никарагуа", "nicaragua"],
    "Панама": ["панама", "panama"],
    "Мексика": ["мексика", "mexico"],
    "Перу": ["перу", "peru"],
    "Боливия": ["боливия", "bolivia"],
    "Эквадор": ["эквадор", "ecuador"],
    "Руанда": ["руанда", "rwanda"],
    "Бурунди": ["бурунди", "burundi"],
    "Танзания": ["танзания", "tanzania"],
    "Уганда": ["уганда", "uganda"],
    "Йемен": ["йемен", "yemen"],
    "Индия": ["индия", "india"],
    "Индонезия": ["индонезия", "indonesia", "суматра", "sumatra", "ява ", "java", "сулавеси", "sulawesi"],
    "Папуа — Новая Гвинея": ["папуа", "papua"],
    "Вьетнам": ["вьетнам", "vietnam"],
    "Китай": ["китай", "china", "юньнань", "yunnan"],
    "Доминикана": ["доминикана", "доминиканская", "dominican"],
    "Ямайка": ["ямайка", "jamaica"],
    "Конго": ["конго", "congo", "drc"],
    "Малави": ["малави", "malawi"],
    "Замбия": ["замбия", "zambia"],
    "Мьянма": ["мьянма", "myanmar"],
    "Таиланд": ["таиланд", "thailand"],
    "Лаос": ["лаос", "laos"],
    "Тимор": ["тимор", "timor"],
}

# ── Регионы (страна → регион → синонимы) ────────────────────────────────
REGIONS = {
    "Эфиопия": {
        "Иргачеффе": ["иргачеф", "йиргачеф", "иргачиф", "yirgacheff", "yirgachef", "irgachef"],
        "Сидамо": ["сидамо", "сидама", "sidamo", "sidama"],
        "Гуджи": ["гуджи", "guji"],
        "Харрар": ["харрар", "харар", "harrar", "harar"],
        "Лиму": ["лиму", "limu"],
        "Джимма": ["джимма", "jimma"],
        "Гедео": ["гедео", "gedeo"],
        "Кочере": ["кочере", "kochere"],
        "Ганра": ["ганра", "ganra"],
        "Бенч Маджи": ["бенч", "bench maji", "bench sheko"],
        "Уллага": ["уллага", "ulaga"],
        "Шакисо": ["шакисо", "shakiso"],
        "Хамбела": ["хамбела", "hambela"],
        "Арси": ["арси", "arsi"],
        "Бенса": ["бенса", "bensa"],
    },
    "Кения": {
        "Ньери": ["ньери", "nyeri"],
        "Кириньяга": ["кириньяга", "kirinyaga"],
        "Мурангa": ["муранга", "murang"],
        "Эмбу": ["эмбу", "embu"],
        "Киамбу": ["киамбу", "kiambu"],
        "Меру": ["меру ", "meru"],
    },
    "Колумбия": {
        "Уила": ["уила", "huila"],
        "Нариньо": ["нариньо", "нарино", "nariño", "narino"],
        "Каука": ["каука", "cauca"],
        "Толима": ["толима", "tolima"],
        "Антиокия": ["антиокия", "antioquia"],
        "Киндио": ["киндио", "quindio", "quindío"],
        "Сантандер": ["сантандер", "santander"],
        "Рисаральда": ["рисаральда", "risaralda"],
    },
    "Бразилия": {
        "Серрадо": ["серрадо", "cerrado"],
        "Сул-де-Минас": ["сул де минас", "сул-де-минас", "sul de minas"],
        "Можиана": ["можиана", "mogiana"],
        "Минас-Жерайс": ["минас", "minas gerais"],
        "Матас-де-Минас": ["матас", "matas de minas"],
        "Шапада-Диамантина": ["шапада", "chapada"],
        "Эспириту-Санту": ["эспириту", "espirito santo", "espírito santo"],
    },
    "Гватемала": {
        "Уэуэтенанго": ["уэуэтенанго", "huehuetenango"],
        "Антигуа": ["антигуа", "antigua"],
        "Атитлан": ["атитлан", "atitlan", "atitlán"],
        "Фрайханес": ["фрайханес", "fraijanes"],
        "Кобан": ["кобан", "coban", "cobán"],
    },
    "Коста-Рика": {
        "Таррасу": ["таррасу", "tarrazu", "tarrazú"],
        "Западная долина": ["западная долина", "west valley", "valle occidental"],
        "Центральная долина": ["central valley", "центральная долина"],
        "Бруннка": ["брунка", "brunca"],
    },
    "Панама": {"Бокете": ["бокете", "boquete"], "Волкан": ["волкан", "volcan", "volcán"]},
    "Перу": {"Кахамарка": ["кахамарка", "cajamarca"], "Куско": ["куско", "cusco"], "Хунин": ["хунин", "junin", "junín"]},
    "Гондурас": {"Санта-Барбара": ["санта барбара", "santa barbara"], "Маркала": ["маркала", "marcala"], "Копан": ["копан", "copan"]},
    "Руанда": {"Ньямашеке": ["ньямашеке", "nyamasheke"], "Хуйе": ["хуйе", "huye"]},
    "Индонезия": {"Суматра": ["суматра", "sumatra"], "Ява": ["ява", "java"], "Сулавеси": ["сулавеси", "sulawesi"], "Ачех": ["ачех", "aceh"]},
}

# ── Обработка ───────────────────────────────────────────────────────────
PROCESSES = [
    ("Анаэробная", ["анаэроб", "anaerob", "anaerobic"]),
    ("Карбоническая мацерация", ["карбоническ", "carbonic"]),
    ("Термошок", ["термошок", "thermal shock", "thermoshock"]),
    ("Ферментация", ["экспериментальн", "ферментац", "fermentation", "co-ferment", "коферм", "infused"]),
    ("Хани", ["хани", "honey", "медов", "pulped natural", "палпд"]),
    ("Влажно-гулящая", ["влажно-гулящ", "wet hulled", "wet-hulled", "гилинг", "giling"]),
    ("Натуральная", ["натурал", "natural", "сухая обработка", "dry process", "naturale"]),
    ("Мытая", ["мытая", "мытый", "мытой", "washed", "lavado", "fully washed", "влажная обработка"]),
]

# ── Сорта ───────────────────────────────────────────────────────────────
VARIETIES = {
    "Гейша": ["гейша", "geisha", "gesha"],
    "Бурбон": ["бурбон", "bourbon"],
    "Розовый бурбон": ["розовый бурбон", "pink bourbon", "бурбон росадо"],
    "Типика": ["типика", "typica"],
    "Катурра": ["катурра", "катура", "caturra"],
    "Катуай": ["катуай", "catuai", "catuaí"],
    "Кастильо": ["кастильо", "castillo"],
    "SL28": ["sl28", "sl-28", "сл28"],
    "SL34": ["sl34", "sl-34", "сл34"],
    "Батиан": ["батиан", "batian"],
    "Руиру 11": ["руиру", "ruiru"],
    "Пакамара": ["пакамара", "pacamara"],
    "Мараджип": ["мараджип", "maragogype", "марагоджип"],
    "Эфиопские ландрейсы": ["heirloom", "хейрлум", "landrace", "ландрейс", "местные сорта", "74110", "74158", "куруме", "kurume", "wolisho", "волишо"],
    "Сидра": ["сидра", "sidra"],
    "Ява": ["сорт ява", "java variety"],
    "Колумбия (сорт)": ["сорт колумбия", "variedad colombia"],
    "Пакас": ["пакас", "pacas"],
    "Вилла Сарчи": ["вилла сарчи", "villa sarchi"],
    "Катимор": ["катимор", "catimor"],
    "Сарчимор": ["сарчимор", "sarchimor"],
    "Мундо Ново": ["мундо ново", "mundo novo"],
    "Эурека": ["эурека", "eugenioides", "эугениоидес"],
    "Лауриина": ["лаурина", "laurina", "бурбон пойнту"],
    "Обата": ["обата", "obata"],
    "Тартака": ["тартака"],
}

# ── Дескрипторы (для фильтра «вкус») ────────────────────────────────────
FLAVOR_GROUPS = {
    "ягоды": ["ягод", "клубник", "малин", "черник", "смородин", "вишн", "черешн", "клюкв", "ежевик", "berry", "strawberr", "raspberr", "blueberr", "cherry", "currant"],
    "цитрус": ["цитрус", "лимон", "лайм", "апельсин", "грейпфрут", "мандарин", "бергамот", "юдзу", "citrus", "lemon", "lime", "orange", "grapefruit", "bergamot"],
    "косточковые": ["персик", "абрикос", "слив", "нектарин", "peach", "apricot", "plum"],
    "тропики": ["манго", "маракуй", "ананас", "папай", "личи", "гуав", "тропич", "mango", "passion", "pineapple", "lychee", "tropical"],
    "цветы": ["жасмин", "роз", "цветоч", "лаванд", "бузин", "чайн", "jasmine", "floral", "rose", "lavender", "tea"],
    "шоколад": ["шоколад", "какао", "chocolate", "cocoa"],
    "орехи": ["орех", "миндал", "фундук", "пекан", "арахис", "nut", "almond", "hazelnut"],
    "карамель": ["карамел", "ирис", "сахар", "мёд", "мед ", "патока", "тростник", "caramel", "toffee", "honey", "molasses", "panela"],
    "сухофрукты": ["изюм", "финик", "чернослив", "инжир", "курага", "raisin", "date", "prune", "fig"],
    "специи": ["специ", "корица", "гвоздик", "кардамон", "перец", "spice", "cinnamon", "clove"],
    "вино/ферментация": ["вин", "ром", "ликер", "ликёр", "ферментир", "wine", "boozy", "rum", "liqueur"],
    "яблоко/груша": ["яблок", "груш", "зелёное яблоко", "apple", "pear"],
}

ROAST_HINTS = [
    ("filter", ["фильтр", "filter", "пуровер", "pour over", "воронк", "аэропресс", "светл", "light roast"]),
    ("espresso", ["эспрессо", "espresso", "тёмн", "темн", "dark roast", "для молока"]),
    ("omni", ["омни", "omni", "универсал", "all-purpose"]),
]

NOT_COFFEE = re.compile(
    r"(кружк|чашк|воронк(?!а для)|фильтры для|весы|кофемолк|чайник|сироп|гейзер|термос|футболк|сертификат|подарочн(?:ая|ый) карт|"
    r"\bчай\b|\bчая\b|матча|какао-напит|шоколадн(?:ая|ый) плитк|капсул|дрип|drip|tea\b|mug|grinder|kettle|merch|gift card|"
    r"декантер|аэропресс|aeropress|v60|кемекс|chemex|холдер|питчер|темпер|бумаг|подписк|фильтр-пакет|фильтр пакет|экстракт|"
    r"в банках|банка |ассорти|худи|half-zip|свитшот|дождевик|шоппер|шапк|носки|значок|стикер|открытк|зонт|бутылк|стакан|"
    r"набор для|комплект|концентрат|cold brew|колд брю)",
    re.I,
)
BLEND_RE = re.compile(r"(смесь|бленд|blend|эспрессо-смесь|купаж)", re.I)
DECAF_RE = re.compile(r"(декаф|без кофеина|decaf)", re.I)

ALT_RE = re.compile(r"(\d{3,4})\s*(?:[-–—]\s*(\d{3,4}))?\s*(?:м|m|метр|masl|над)", re.I)
SCA_RE = re.compile(r"(?:sca|q[- ]?grade|оценк[аи]|балл|score)[^\d]{0,12}(8\d(?:[.,]\d{1,2})?)", re.I)
WEIGHT_RE = re.compile(r"(\d+(?:[.,]\d+)?)\s*(кг|kg|г|гр|g)\b", re.I)


def fold(s: str) -> str:
    s = unicodedata.normalize("NFKC", s or "").lower().replace("ё", "е")
    return re.sub(r"\s+", " ", s)


def _find(text: str, syns: list[str]) -> bool:
    return any(fold(x) in text for x in syns)


def detect_country(text: str) -> str | None:
    hits = [(text.find(fold(s)), c) for c, ss in COUNTRIES.items() for s in ss if fold(s) in text]
    if not hits:
        # регион без страны: «Иргачеффе» → Эфиопия
        for country, regions in REGIONS.items():
            for syns in regions.values():
                if _find(text, syns):
                    return country
        return None
    return min(hits)[1]


def detect_region(text: str, country: str | None) -> str | None:
    pools = [country] if country in REGIONS else list(REGIONS)
    for c in pools:
        for region, syns in REGIONS.get(c, {}).items():
            if _find(text, syns):
                return region
    return None


def detect_process(text: str) -> str | None:
    found = [name for name, syns in PROCESSES if _find(text, syns)]
    if not found:
        return None
    # «анаэробная натуральная» → основная — экспериментальная, базовая — вторая
    return found[0]


def detect_varieties(text: str) -> list[str]:
    out = [v for v, syns in VARIETIES.items() if _find(text, syns)]
    if "Розовый бурбон" in out and "Бурбон" in out:
        out.remove("Бурбон")
    return out


def detect_flavors(text: str) -> list[str]:
    return [g for g, syns in FLAVOR_GROUPS.items() if _find(text, syns)]


def detect_roast(text: str) -> str | None:
    found = [r for r, syns in ROAST_HINTS if _find(text, syns)]
    if not found:
        return None
    if "omni" in found or ("filter" in found and "espresso" in found):
        return "omni"
    return found[0]


def detect_altitude(text: str) -> list[int] | None:
    for m in ALT_RE.finditer(text):
        lo = int(m.group(1))
        hi = int(m.group(2)) if m.group(2) else lo
        if 600 <= lo <= 2800 and 600 <= hi <= 2800:
            return [min(lo, hi), max(lo, hi)]
    return None


def detect_score(text: str) -> float | None:
    m = SCA_RE.search(text)
    if m:
        v = float(m.group(1).replace(",", "."))
        if 80 <= v <= 95:
            return v
    return None


def parse_weight_g(s: str) -> int | None:
    m = WEIGHT_RE.search(s or "")
    if not m:
        return None
    v = float(m.group(1).replace(",", "."))
    g = v * 1000 if m.group(2).lower() in ("кг", "kg") else v
    return int(g) if 30 <= g <= 5000 else None


def extract_notes(description: str) -> str | None:
    """Строка дескрипторов — обычно после «Дескрипторы:», «Вкус:», «В чашке:»."""
    m = re.search(r"(?:дескриптор\w*|вкус(?:овой профиль)?|в чашке|ноты|tasting notes|notes|профиль)\s*[:—-]\s*([^\n.]{5,160})",
                  description or "", re.I)
    return m.group(1).strip(" ;,") if m else None


NON_COFFEE_URL = re.compile(
    r"merch|aksessuar|accessor|arkhiv|archive|filtr[-_]?paket|drip|kapsul|capsul|ekstrakt|extract|napitk|v[-_]bankakh|"
    r"shokolad|chocolate|sertifikat|certificate|gift|podpisk|subscri|dlya[-_]yur|yur[-_]lits|wholesale|posuda|chay|/tea|"
    r"oborudovan|equipment|syrop|-old$|-old/", re.I)


def is_coffee(name: str, description: str = "", category: str = "", url: str = "") -> bool:
    if NOT_COFFEE.search(name or "") or NON_COFFEE_URL.search(url or ""):
        return False
    blob = fold(f"{name} {category} {description[:600]}")
    if detect_country(blob) or BLEND_RE.search(blob):
        return True
    return bool(re.search(r"кофе|coffee|зерн|арабик|arabica", blob))


def _spec(specs: dict, *keys: str) -> str:
    return fold(" ".join(str(specs[k]) for k in keys if specs.get(k)))


def _process_unique(text: str) -> str | None:
    """По прозе определяем обработку, только если упомянута ровно одна — иначе это рассказ о процессах вообще."""
    found = {name for name, syns in PROCESSES if _find(text, syns)}
    return found.pop() if len(found) == 1 else None


ROAST_LEVEL = [("filter", ["светл", "фильтр", "filter", "light"]), ("espresso", ["темн", "эспрессо", "espresso", "dark"]),
               ("omni", ["омни", "omni", "универс"])]


def enrich(item: dict) -> dict:
    """Дополняет сырой товар нормализованными атрибутами.
    Приоритет: таблица характеристик со страницы → название → описание."""
    name = item.get("name", "")
    desc = item.get("description", "")
    specs = item.get("specs") or {}
    title = fold(name)
    blob = fold(f"{name}\n{desc}")
    s_country, s_region = _spec(specs, "Страна"), _spec(specs, "Регион", "Провинция")
    s_proc = _spec(specs, "Способ обработки", "Обработка")
    s_var = _spec(specs, "Разновидность", "Сорт", "Сорта")
    country = detect_country(title) or detect_country(s_country) or detect_country(s_region) or detect_country(blob)
    region = detect_region(title, country) or detect_region(s_region, country) or detect_region(blob, country)
    if not region and specs.get("Регион") and "," not in specs["Регион"] and "/" not in specs["Регион"] and not detect_country(s_region):
        region = specs["Регион"].strip().capitalize()  # регион не из словаря — берём как есть
    roast = None
    for r, syns in ROAST_LEVEL:
        if _find(_spec(specs, "Обжарка", "Степень обжарки"), syns):
            roast = r
            break
    blend_spec = bool(re.search(r"смесь|бленд|blend", s_proc + " " + s_var))
    def _listy(v):  # дескрипторы — это список коротких слов, а не фраза
        return v and all(len(x.split()) <= 4 for x in re.split(r"[,;/]", v)) and not re.match(r"[а-яё]+ [а-яё]+ [а-яё]+ [а-яё]+ [а-яё]+", v)
    notes = item.get("notes") or next((specs[k] for k in ("Дескрипторы", "Вкус", "Вкусовой профиль") if _listy(specs.get(k))), None)
    attrs = {
        "country": country,
        "region": region,
        "process": detect_process(s_proc) or detect_process(title) or _process_unique(blob),
        "varieties": [v for v in detect_varieties(s_var or blob) if not (blend_spec and v == "Бленд")],
        "flavors": detect_flavors(fold(notes or "") or blob),
        "roast": detect_roast(title) or roast or detect_roast(blob),
        "altitude": detect_altitude(specs.get("Высота", "") or specs.get("Высота произрастания", "")) or detect_altitude(desc),
        "score": detect_score(_spec(specs, "Оценка", "Оценка sca", "Q-grade") + " " + blob),
        "is_blend": blend_spec or (bool(BLEND_RE.search(title)) and not (country and not re.search(r"смесь|blend|бленд", title))),
        "is_decaf": bool(DECAF_RE.search(blob)),
        "notes": notes or extract_notes(desc),
    }
    item.update({k: v for k, v in attrs.items() if v not in (None, [], "") or k in ("is_blend", "is_decaf")})
    return item
