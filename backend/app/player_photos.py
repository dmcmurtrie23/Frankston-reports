"""Player photos from a team web page (e.g. a club's squad page), matched to the app's player names.

1. scan(url): read the page, pull out each (name, photo) pair — from an image's alt/title text, or
   from a small block (card / list item / link / figure) holding one photo and a short name — and
   match the names to the players in the app, allowing for nicknames ("Lachie" = "Lachlan"),
   initials and small spelling differences. Unsure matches are marked for checking, never guessed.
2. save(items): download the chosen photos into Frankston_Reports/sport_science_data/photos/
   as first-last.<ext> (same naming as the sport science app), served back at /api/photos/file/<slug>.

Matching is by the names printed on the page — it doesn't recognise faces.
"""
from __future__ import annotations

import difflib
import json
import re
from html.parser import HTMLParser
from urllib.parse import urljoin

import httpx

from .fss import catapult_api
from .fss.config import DATA

PHOTOS_DIR = DATA / "photos"
INDEX = PHOTOS_DIR / "index.json"
UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/124.0 Safari/537.36", "Accept-Language": "en-AU,en;q=0.9"}

NICK = {  # nickname -> formal first names it can stand for
    "lachie": ["lachlan"], "lachy": ["lachlan"], "will": ["william"], "bill": ["william"], "tom": ["thomas"],
    "tommy": ["thomas"], "sam": ["samuel"], "sammy": ["samuel"], "ollie": ["oliver"], "olly": ["oliver"],
    "matt": ["matthew"], "matty": ["matthew"], "nick": ["nicholas", "nicolas"], "josh": ["joshua"],
    "zac": ["zachary"], "zach": ["zachary"], "max": ["maxwell", "maximilian"], "pat": ["patrick"],
    "paddy": ["patrick"], "charlie": ["charles"], "harry": ["harrison", "henry", "harold"], "alex": ["alexander"],
    "ben": ["benjamin"], "benny": ["benjamin"], "dan": ["daniel"], "danny": ["daniel"], "jake": ["jacob"],
    "mitch": ["mitchell"], "jono": ["jonathan"], "jon": ["jonathan"], "nate": ["nathan", "nathaniel"],
    "chris": ["christopher", "christian"], "mick": ["michael"], "mike": ["michael"], "tim": ["timothy"],
    "joe": ["joseph"], "joey": ["joseph"], "jimmy": ["james"], "jim": ["james"], "freddie": ["frederick"],
    "fred": ["frederick"], "ed": ["edward"], "eddie": ["edward"], "ned": ["edward"], "andy": ["andrew"],
    "drew": ["andrew"], "rob": ["robert"], "bobby": ["robert"], "jack": ["john", "jackson"], "johnny": ["john"],
    "seb": ["sebastian"], "tobe": ["tobias"], "toby": ["tobias"], "angus": ["angus"], "gus": ["angus", "augustus"],
    "jamie": ["james"], "tommo": ["thomas"], "tomo": ["thomas"], "darcy": ["darcy"], "kade": ["kade"],
}
IMG_EXT = {"image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif"}
JUNK = re.compile(r"logo|icon|sponsor|banner|badge|arrow|placeholder|social|facebook|instagram|twitter|youtube", re.I)


def slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def _norm(name: str) -> list:
    n = re.sub(r"\(.*?\)|#?\d+", " ", name)            # drop "(c)", guernsey numbers
    n = re.sub(r"[^A-Za-z' \-]", " ", n).replace("'", "").lower()
    return [w for w in n.replace("-", " - ").split() if w]


def _looks_like_name(text: str) -> bool:
    words = [w for w in re.split(r"\s+", text.strip()) if w]
    return 2 <= len(words) <= 5 and sum(bool(re.match(r"^[A-Za-z][A-Za-z'\-\.]*$", w)) for w in words) >= 2 \
        and len(text) <= 40 and not JUNK.search(text)


# ---------------------------------------------------------------- page reading

class _Page(HTMLParser):
    BLOCKS = {"a", "li", "figure", "article", "div", "section", "td", "tr"}

    def __init__(self, base):
        super().__init__(convert_charrefs=True)
        self.base = base
        self.stack = []        # open block elements: {"tag", "imgs": [...], "text": [...]}
        self.pairs = []        # (name, image url, how)
        self.skip = 0

    def _img_url(self, a):
        for k in ("data-src", "data-lazy-src", "data-original", "src"):
            v = a.get(k)
            if v and not v.startswith("data:"):
                return urljoin(self.base, v.strip())
        srcset = a.get("data-srcset") or a.get("srcset")
        if srcset:
            last = srcset.split(",")[-1].strip().split(" ")[0]
            return urljoin(self.base, last)
        return None

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag in ("script", "style", "noscript"):
            self.skip += 1
        if tag == "img":
            url = self._img_url(a)
            if not url or JUNK.search(url):
                return
            alt = (a.get("alt") or a.get("title") or "").strip()
            if _looks_like_name(alt):
                self.pairs.append((alt, url, "alt"))
            for b in self.stack:
                b["imgs"].append(url)
            return
        if tag in self.BLOCKS:
            self.stack.append({"tag": tag, "imgs": [], "text": [],
                               "label": (a.get("aria-label") or a.get("title") or "").strip()})
        # background-image photos (style="background-image:url(...)")
        m = re.search(r"url\(['\"]?([^'\")]+)", a.get("style", "") or "")
        if m and self.stack and not JUNK.search(m.group(1)):
            for b in self.stack:
                b["imgs"].append(urljoin(self.base, m.group(1)))

    def handle_endtag(self, tag):
        if tag in ("script", "style", "noscript"):
            self.skip = max(0, self.skip - 1)
        if tag in self.BLOCKS:
            for i in range(len(self.stack) - 1, -1, -1):
                if self.stack[i]["tag"] == tag:
                    b = self.stack.pop(i)
                    self._close(b)
                    break

    def handle_data(self, data):
        if self.skip or not data.strip():
            return
        for b in self.stack:
            b["text"].append(data.strip())

    def _close(self, b):
        imgs = list(dict.fromkeys(b["imgs"]))
        if len(imgs) != 1:
            return
        bits = [t for t in b["text"] if not re.fullmatch(r"[#\d\s\.\-|·]+", t)]
        cands = [b["label"]] if _looks_like_name(b["label"]) else []
        joined = " ".join(bits)
        if _looks_like_name(joined):
            cands.append(joined)
        if len(bits) >= 2 and _looks_like_name(f"{bits[0]} {bits[1]}"):   # first / last name in separate spans
            cands.append(f"{bits[0]} {bits[1]}")
        cands += [t for t in bits if _looks_like_name(t)]
        if cands:
            self.pairs.append((cands[0], imgs[0], b["tag"]))


def read_page(url: str) -> list:
    with httpx.Client(timeout=30, follow_redirects=True, headers=UA) as c:
        r = c.get(url)
        r.raise_for_status()
        html = r.text
    p = _Page(str(r.url))
    p.feed(html)
    seen, imgs, out = set(), set(), []
    for name, img, how in p.pairs:
        key = " ".join(_norm(name))
        if key and key not in seen and img not in imgs:      # one name per photo (alt text wins)
            seen.add(key)
            imgs.add(img)
            out.append({"page_name": " ".join(name.split()), "image_url": img})
    return out


# ---------------------------------------------------------------- matching

def _first_ok(page_first: str, app_first: str) -> float:
    if page_first == app_first:
        return 1.0
    if app_first in NICK.get(page_first, []) or page_first in NICK.get(app_first, []):
        return 0.92
    if len(page_first) >= 3 and (app_first.startswith(page_first) or page_first.startswith(app_first)):
        return 0.9
    if len(page_first) == 1 and app_first.startswith(page_first):
        return 0.85
    return difflib.SequenceMatcher(None, page_first, app_first).ratio() * 0.9


def match(page: list, players: list) -> dict:
    app = [(p, _norm(p)) for p in players]
    used, matches = set(), []
    for item in page:
        w = _norm(item["page_name"])
        if len(w) < 2:
            continue
        first, last = w[0], " ".join(w[1:])
        best, score = None, 0.0
        for p, pw in app:
            if len(pw) < 2:
                continue
            p_first, p_last = pw[0], " ".join(pw[1:])
            last_s = 1.0 if p_last == last else difflib.SequenceMatcher(None, p_last, last).ratio()
            if last_s < 0.85:
                continue
            s = last_s * _first_ok(first, p_first)
            if s > score:
                best, score = p, s
        if best is None:
            # surname only, if exactly one player has it
            same = [p for p, pw in app if len(pw) >= 2 and " ".join(pw[1:]) == last]
            if len(same) == 1:
                best, score = same[0], 0.6
        matches.append({**item, "player": best, "score": round(score, 2),
                        "status": "match" if best and score >= 0.85 else ("check" if best else "none")})
    # one photo per player: keep the best, mark the rest for checking
    order = sorted(range(len(matches)), key=lambda i: -matches[i]["score"])
    for i in order:
        m = matches[i]
        if m["player"] and m["player"] in used:
            m["status"] = "check"
        elif m["player"]:
            used.add(m["player"])
    have = load_index()
    return {"items": matches,
            "players_without_photo": sorted(p for p in players if p not in used and slug(p) not in have)}


def app_players(extra: list) -> list:
    names = set(n for n in (extra or []) if n)
    try:
        sp = catapult_api.load_speed()
        names |= set(sp["player"].dropna().astype(str))
    except Exception:  # noqa: BLE001
        pass
    return sorted(names)


def scan(url: str, names: list) -> dict:
    page = read_page(url)
    out = match(page, app_players(names))
    out["found_on_page"] = len(page)
    return out


# ---------------------------------------------------------------- saving / serving

def load_index() -> dict:
    try:
        return json.loads(INDEX.read_text())
    except Exception:  # noqa: BLE001
        return {}


def save(items: list, referer: str = "") -> dict:
    PHOTOS_DIR.mkdir(parents=True, exist_ok=True)
    idx = load_index()
    saved, failed = [], []
    headers = {**UA, **({"Referer": referer} if referer else {})}
    with httpx.Client(timeout=30, follow_redirects=True, headers=headers) as c:
        for it in items:
            player, url = it.get("player"), it.get("image_url")
            if not player or not url:
                continue
            try:
                r = c.get(url)
                r.raise_for_status()
                ctype = r.headers.get("content-type", "").split(";")[0].strip().lower()
                ext = IMG_EXT.get(ctype) or (url.rsplit(".", 1)[-1].split("?")[0].lower()
                                              if "." in url.rsplit("/", 1)[-1] else "jpg")
                if ext not in ("jpg", "jpeg", "png", "webp", "gif"):
                    ext = "jpg"
                s = slug(player)
                for old in PHOTOS_DIR.glob(f"{s}.*"):
                    if old.name != f"{s}.{ext}":
                        try:
                            old.unlink()
                        except OSError:
                            pass
                (PHOTOS_DIR / f"{s}.{ext}").write_bytes(r.content)
                idx[s] = {"player": player, "file": f"{s}.{ext}", "source": url}
                saved.append(player)
            except Exception as e:  # noqa: BLE001
                failed.append({"player": player, "error": str(e)[:120]})
    INDEX.write_text(json.dumps(idx, indent=1))
    return {"saved": saved, "failed": failed, "photos": photo_map()}


def photo_map() -> dict:
    """{player name: url path} for every saved photo."""
    return {v["player"]: f"/api/photos/file/{k}" for k, v in load_index().items()
            if (PHOTOS_DIR / v["file"]).exists()}


def remove(player: str) -> dict:
    idx = load_index()
    s = slug(player)
    if s in idx:
        try:
            (PHOTOS_DIR / idx[s]["file"]).unlink()
        except OSError:
            pass
        idx.pop(s)
        INDEX.write_text(json.dumps(idx, indent=1))
    return {"photos": photo_map()}
