#!/usr/bin/env python3
"""Build data/grants.csv from the raw snapshots in data/raw/.

Each parser is a pure function that returns a list of grant dicts. We only use
publicly disclosed, named grants. Anonymized grants are never reconstructed.

Run from anywhere:  python3 scrapers/build_grants.py
"""
import csv
import datetime as dt
import glob
import html
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import common as C  # noqa: E402

RAW = os.path.join(ROOT, "data", "raw")
OUT = os.path.join(ROOT, "data", "grants.csv")
RETRIEVED = "2026-10-28"  # date the raw snapshots were taken

FIELDS = [
    "id", "funder", "fund", "grantee", "title", "amount_usd",
    "date", "date_precision", "year", "cause_area", "tags",
    "is_regrant", "source_id", "source_url", "retrieved_at",
]

MON_ABBR = [""] + ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
MONTHS = {m.lower(): i for i, m in enumerate(
    ["", "January", "February", "March", "April", "May", "June", "July",
     "August", "September", "October", "November", "December"])}


def strip_html(x):
    return html.unescape(re.sub(r"<[^>]+>", " ", x or "")).strip()


def collapse(x):
    return re.sub(r"\s+", " ", x or "").strip()


# --------------------------------------------------------------------------
# EA Funds (AWF / LTFF / EAIF / GHD)
# --------------------------------------------------------------------------
EA_FUND_CAUSE = {
    "Animal Welfare Fund": C.CAUSE_ANIMAL,
    "Long-Term Future Fund": C.CAUSE_AISAFETY,
    "EA Infrastructure Fund": C.CAUSE_OTHER,
    "Effective Altruism Infrastructure Fund": C.CAUSE_OTHER,
    "Global Health and Development Fund": C.CAUSE_OTHER,
}


def parse_ea_funds():
    path = os.path.join(RAW, "ea_funds", "grants.csv")
    out = []
    with open(path, newline="", encoding="utf-8") as f:
        raw = list(csv.DictReader(f))
    # The API appends a `grantsAddonData[*]` block (mostly Global Health grants
    # with no Airtable id). A few of those rows re-list a real `rec*` grant;
    # drop just those confirmed duplicates.
    ekey = lambda x: (x["grantee"].strip().lower(), x["description"].strip().lower(),
                      x["amount"], x["round"].strip())
    real_keys = {ekey(x) for x in raw if not x["id"].startswith("grantsAddonData")}
    for r in raw:
        if r["id"].startswith("grantsAddonData") and ekey(r) in real_keys:
            continue
        fund = r["fund"].strip()
        desc = collapse(r["description"])
        base = EA_FUND_CAUSE.get(fund, C.CAUSE_OTHER)
        # Within the Animal Welfare Fund, split out AI x animals grants.
        if base == C.CAUSE_ANIMAL:
            cause = C.CAUSE_ANIMAL
        else:
            cause = base
        rnd = (r.get("round") or "").strip()
        year = (r.get("year") or "").strip()
        date, prec = ea_date(rnd, year)
        text = f"{r['grantee']} {desc}"
        amt = C.parse_money(r["amount"]) or 0
        regrant = bool(re.search(r"regrant|re-grant", desc, re.I))
        out.append({
            "id": f"eafunds:{r['id']}",
            "funder": "EA Funds",
            "fund": fund,
            "grantee": collapse(r["grantee"]),
            "title": desc,
            "amount_usd": amt,
            "date": date,
            "date_precision": prec,
            "year": year or (date[:4] if date else ""),
            "cause_area": cause,
            "tags": C.tags_join(C.tag_species(text), C.tag_region(text), C.tag_ai(text)),
            "is_regrant": regrant,
            "source_id": "ea_funds",
            "source_url": "https://funds.effectivealtruism.org/grants",
            "retrieved_at": RETRIEVED,
        })
    return out


def ea_date(rnd, year):
    m = re.search(r"Q([1-4])", rnd)
    if m and year:
        q = int(m.group(1))
        return f"{year}-{(q - 1) * 3 + 1:02d}-01", "quarter"
    if year:
        return f"{year}-01-01", "year"
    return "", "unknown"


# --------------------------------------------------------------------------
# Manifund
# --------------------------------------------------------------------------
MANIFUND_CAUSE = [  # priority order
    ("falcon-fund", C.CAUSE_ANIMAL),
    ("animal-welfare", C.CAUSE_ANIMAL),
    ("digital-minds", C.CAUSE_DIGITAL),
    ("tais", C.CAUSE_AISAFETY),
    ("ai-gov", C.CAUSE_AISAFETY),
    ("ais-fieldbuilding", C.CAUSE_AISAFETY),
    ("ais-advocacy", C.CAUSE_AISAFETY),
    ("grantmaking-ai", C.CAUSE_AISAFETY),
    ("ai-worldviews", C.CAUSE_AISAFETY),
]


STRICT_ANIMAL = re.compile(
    r"\b(animal|chicken|fish|shrimp|farmed|cage[- ]?free|livestock|insect|aquatic|slaughter|decapod|vegan|cultivated meat)s?\b", re.I)


def parse_manifund():
    path = os.path.join(RAW, "manifund", "projects_all.json")
    data = json.load(open(path, encoding="utf-8"))
    out = []
    for p in data:
        slugs = {c["slug"] for c in (p.get("causes") or [])}
        cause = None
        for slug, cz in MANIFUND_CAUSE:
            if slug in slugs:
                cause = cz
                break
        untagged = False
        # "Global catastrophic risks" is broad (biosecurity, nuclear, ...): keep only the projects that are about AI.
        if cause is None and "gcr" in slugs and C.tag_cause(collapse(p.get("title")) + " " + collapse(p.get("blurb"))) == C.CAUSE_AISAFETY:
            cause = C.CAUSE_AISAFETY
        if cause is None:
            # Not filed under an animal cause, but the project itself is about animals (e.g. ACX Grants).
            if STRICT_ANIMAL.search(collapse(p.get("title")) + " " + collapse(p.get("blurb"))):
                cause, untagged = C.CAUSE_ANIMAL, True
            else:
                continue  # not in our tracked Manifund causes
        amt = sum(t["amount"] for t in (p.get("txns") or []) if t.get("token") == "USD")
        if amt <= 0:
            continue  # unfunded proposal
        prof = p.get("profiles") or {}
        grantee = prof.get("full_name") or prof.get("username") or "(unknown)"
        title = collapse(p.get("title"))
        # The Falcon Fund project is itself a regranting intermediary.
        regrant = bool(re.search(r"\bfalcon fund\b|regrant", title, re.I))
        created = (p.get("created_at") or "")[:10]
        text = f"{title} {collapse(p.get('blurb'))}"
        out.append({
            "id": f"manifund:{p['id']}",
            "funder": "Manifund",
            "fund": "Manifund – " + ("Falcon Fund (AI × animals)" if "falcon-fund" in slugs else C.CAUSE_LABELS[cause] + (" (other cause tags)" if untagged else "")),
            "grantee": grantee,
            "title": title,
            "amount_usd": int(round(amt)),
            "date": created,
            "date_precision": "created",  # project creation, not grant date
            "year": created[:4],
            "cause_area": cause,
            "tags": C.tags_join(C.tag_species(text), C.tag_region(text), C.tag_ai(text)),
            "is_regrant": regrant,
            "source_id": "manifund",
            "source_url": f"https://manifund.org/projects/{p.get('slug','')}",
            "retrieved_at": RETRIEVED,
        })
    return out


# --------------------------------------------------------------------------
# SFF (Survival and Flourishing Fund)
# --------------------------------------------------------------------------
def parse_sff():
    out = []
    for path in sorted(glob.glob(os.path.join(RAW, "sff", "recs_*.html"))):
        base = os.path.basename(path)[len("recs_"):-len(".html")]  # "2019" or "2020_h1"
        parts = base.split("_")
        year = parts[0]
        if len(parts) == 2:
            half = parts[1].lower()
            label = f"{year} {parts[1].upper()}"
            url = f"https://survivalandflourishing.fund/{year}/{half}/recommendations"
            date = f"{year}-{1 if half == 'h1' else 7:02d}-01"
            prec = "half"
        else:
            label = year
            url = f"https://survivalandflourishing.fund/{year}/recommendations"
            date = f"{year}-01-01"
            prec = "year"
        h = open(path, encoding="utf-8").read()
        # Pick whichever layout yields more rows: newer grid vs older HTML table.
        ingrid, table = _sff_ingrid(h), _sff_table(h)
        rows = ingrid if len(ingrid) >= len(table) else table
        for n, (grantee, amt, purpose, org) in enumerate(rows):
            if not grantee or not amt:
                continue
            text = f"{org} {purpose}"
            # SFF is predominantly an AI / global-catastrophic-risk funder.
            # Bucket its non-animal grants under ai_safety (see methodology).
            cause = C.tag_cause(text)
            if cause == C.CAUSE_OTHER:
                cause = C.CAUSE_AISAFETY
            out.append({
                "id": f"sff:{base}:{n}",
                "funder": "SFF",
                "fund": f"SFF {label} round",
                "grantee": grantee,
                "title": purpose or org,
                "amount_usd": amt,
                "date": date,
                "date_precision": prec,
                "year": year,
                "cause_area": cause,
                "tags": C.tags_join(C.tag_species(text), C.tag_region(text), C.tag_ai(text)),
                "is_regrant": False,
                "source_id": "sff",
                "source_url": url,
                "retrieved_at": RETRIEVED,
            })
    return out


def _sff_grantee(charity, org):
    """Prefer the applicant org when the receiving charity is an undetermined
    fiscal-sponsor placeholder (e.g. "TBD via Lightspeed Grant announcement")."""
    if not charity or re.search(r"\btbd\b|lightspeed|^via\b", charity, re.I):
        return org
    return charity


def _sff_ingrid(h):
    """Newer SFF layout: a 6-column grid of div.in-grid cells."""
    cells = [collapse(strip_html(c)) for c in
             re.findall(r'<div[^>]*class="[^"]*in-grid[^"]*"[^>]*>(.*?)</div>', h, re.S)]
    out, i = [], 0
    while i < len(cells):
        if cells[i] == "Source":
            i += 6
            continue
        row = cells[i:i + 6]
        i += 6
        if len(row) < 6:
            continue
        source, org, track, total, charity, purpose = row[:6]
        out.append((_sff_grantee(charity, org), C.parse_money(total), purpose, org))
    return out


def _sff_table(h):
    """Older SFF layout: an HTML table whose columns vary by round. We read the
    header to locate Organization / Amount(s) / Receiving Charity / Purpose, and
    sum every amount column (SFF splits the total across per-funder columns)."""
    out = []
    for tbl in re.findall(r"<table.*?</table>", h, re.S):
        trs = re.findall(r"<tr>(.*?)</tr>", tbl, re.S)
        if not trs:
            continue
        rows = [[collapse(strip_html(c)) for c in
                 re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", tr, re.S)] for tr in trs]
        header = rows[0]
        low = [c.lower() for c in header]
        amt_idx = [i for i, c in enumerate(low) if "amount" in c]
        org_idx = next((i for i, c in enumerate(low) if c == "organization"), None)
        char_idx = next((i for i, c in enumerate(low) if "receiving charity" in c), None)
        purp_idx = next((i for i, c in enumerate(low) if "purpose" in c), None)
        if not amt_idx or org_idx is None:
            continue
        for cells in rows[1:]:
            if len(cells) <= max(amt_idx + [org_idx]):
                continue
            amt = sum(C.parse_money(cells[i]) or 0 for i in amt_idx)
            org = cells[org_idx]
            charity = cells[char_idx] if char_idx is not None and char_idx < len(cells) else ""
            purpose = cells[purp_idx] if purp_idx is not None and purp_idx < len(cells) else ""
            out.append((_sff_grantee(charity, org), amt, purpose, org))
    return out


# --------------------------------------------------------------------------
# ACE Movement Grants
# --------------------------------------------------------------------------
def parse_ace():
    path = os.path.join(RAW, "ace", "past.html")
    h = open(path, encoding="utf-8").read()
    out = []
    # Each round is a su-spoiler block: a title (round date) then a 2-col table.
    blocks = re.split(r'class="su-spoiler-title"', h)[1:]
    for n, b in enumerate(blocks):
        mtitle = re.search(r">([^<]*\d{4}[^<]*)</div>", b)
        if not mtitle:
            # title sits after the icon span
            mtitle = re.search(r"</span>\s*([^<]+)</div>", b)
        round_title = collapse(strip_html(mtitle.group(1))) if mtitle else f"round {n}"
        date, prec = ace_date(round_title)
        tbl = re.search(r"<table.*?</table>", b, re.S)
        if not tbl:
            continue
        rows = re.findall(r"<tr>\s*<td>(.*?)</td>\s*<td>(.*?)</td>\s*</tr>", tbl.group(0), re.S)
        for gi, (g, a) in enumerate(rows):
            grantee = collapse(strip_html(g))
            amt = C.parse_money(strip_html(a))
            if not grantee or not amt:
                continue
            out.append({
                "id": f"ace:{date or n}:{gi}",
                "funder": "ACE Movement Grants",
                "fund": "ACE Movement Grants",
                "grantee": grantee,
                "title": f"Movement Grant ({round_title})",
                "amount_usd": amt,
                "date": date,
                "date_precision": prec,
                "year": date[:4] if date else "",
                "cause_area": C.CAUSE_ANIMAL,
                "tags": C.tags_join(C.tag_species(grantee), C.tag_region(grantee)),
                "is_regrant": False,
                "source_id": "ace",
                "source_url": "https://animalcharityevaluators.org/movement-grants/past-movement-grants-recipients/",
                "retrieved_at": RETRIEVED,
            })
    return out


# --------------------------------------------------------------------------
# Coefficient Giving (formerly Open Philanthropy) - Farm Animal Welfare
# Collected manually in a real browser (site returns 403 to scripts).
# --------------------------------------------------------------------------
CG_REGRANT = re.compile(
    r"regrant|re-grant|navigation fund|founders pledge|spring innovation fund|"
    r"implementation fund|pooled fund", re.I)


def parse_cg():
    path = os.path.join(RAW, "cg", "faw.tsv")
    if not os.path.exists(path):
        return []
    out = []
    with open(path, newline="", encoding="utf-8") as f:
        for i, r in enumerate(csv.DictReader(f, delimiter="\t")):
            grantee = collapse(r["grantee"])
            title = collapse(r["title"])
            amt = C.parse_money(r["amount"])
            if not grantee or not amt:
                continue
            date, prec = cg_date(r["date"])
            text = f"{grantee} {title}"
            # Farm Animal Welfare fund: animal by default, AI x animals if flagged.
            cause = C.CAUSE_ANIMAL
            out.append({
                "id": f"cg:{date or i}:{i}",
                "funder": "Coefficient Giving",
                "fund": "Farm Animal Welfare",
                "grantee": grantee,
                "title": title,
                "amount_usd": amt,
                "date": date,
                "date_precision": prec,
                "year": date[:4] if date else "",
                "cause_area": cause,
                "tags": C.tags_join(C.tag_species(text), C.tag_region(text), C.tag_ai(text)),
                "is_regrant": bool(CG_REGRANT.search(text)),
                "source_id": "cg",
                "source_url": "https://coefficientgiving.org/funds/farm-animal-welfare/",
                "retrieved_at": RETRIEVED,
            })
    return out


# Coefficient Giving's AI fund: grants that hand money to another body to award onward.
# Listed explicitly (not fuzzy-matched) so every regrant flag can be audited.
CG_TAI_PASSTHROUGH = [
    ("national science foundation", "safe learning-enabled"),   # co-funded NSF programme
    ("longview philanthropy", "rfp on hardware-enabled"),        # Longview runs the RFP
]


def parse_cg_tai():
    """Coefficient Giving 'Navigating Transformative AI' fund (collected by hand in a browser, like the FAW fund)."""
    path = os.path.join(RAW, "cg", "tai.tsv")
    if not os.path.exists(path):
        return []
    out = []
    # A few rows are listed on both of CG's fund pages. They belong to the farm animal fund, so the AI file drops them.
    faw_path = os.path.join(RAW, "cg", "faw.tsv")
    faw = set()
    if os.path.exists(faw_path):
        with open(faw_path, newline="", encoding="utf-8") as f:
            faw = {(collapse(r["grantee"]), collapse(r["title"]), r["date"], r["amount"]) for r in csv.DictReader(f, delimiter="\t")}
    with open(path, newline="", encoding="utf-8") as f:
        for i, r in enumerate(csv.DictReader(f, delimiter="\t")):
            grantee, title, amt = collapse(r["grantee"]), collapse(r["title"]), C.parse_money(r["amount"])
            if not grantee or not amt:
                continue
            if (grantee, title, r["date"], r["amount"]) in faw:
                print(f"[cg_tai] dropped duplicate also on the farm animal page: {grantee} | {clip(title, 40)} | {r['amount']}", file=sys.stderr)
                continue
            date, prec = cg_date(r["date"])
            low = (grantee.lower(), title.lower())
            regrant = bool(re.search(r"regrant", title, re.I)) or any(low[0] == g and low[1].startswith(t) for g, t in CG_TAI_PASSTHROUGH)
            out.append({
                "id": f"cgtai:{date or i}:{i}",
                "funder": "Coefficient Giving",
                "fund": "Navigating Transformative AI",
                "grantee": grantee,
                "title": title,
                "amount_usd": amt,
                "date": date,
                "date_precision": prec,
                "year": date[:4] if date else "",
                "cause_area": C.CAUSE_AISAFETY,
                "tags": "",
                "is_regrant": regrant,
                "source_id": "cg_tai",
                "source_url": "https://coefficientgiving.org/funds/navigating-transformative-ai/",
                "retrieved_at": RETRIEVED,
            })
    return out


def cg_date(s):
    m = re.search(r"([A-Za-z]+)\s+(\d{4})", s or "")
    if m and m.group(1).lower() in MONTHS:
        return f"{m.group(2)}-{MONTHS[m.group(1).lower()]:02d}-01", "month"
    m = re.search(r"(\d{4})", s or "")
    if m:
        return f"{m.group(1)}-01-01", "year"
    return "", "unknown"


def ace_date(title):
    m = re.search(r"([A-Za-z]+),?\s*(\d{4})", title)
    if m and m.group(1).lower() in MONTHS:
        mo = MONTHS[m.group(1).lower()]
        return f"{m.group(2)}-{mo:02d}-01", "month"
    m = re.search(r"(\d{4})", title)
    if m:
        return f"{m.group(1)}-01-01", "year"
    return "", "unknown"


# --------------------------------------------------------------------------
# ACE Recommended Charity Fund: twice-yearly distributions to ACE's recommended charities.
# Each round is a heading ("July 1 - December 31, 2025  In February, we distributed $X ...")
# followed by a table: Recommended Charity | Amount | Percentage | [Reasoning].
# The month in the heading is when the money was DISBURSED, so a Jul-Dec 2025 round paid in
# February is dated Feb 2026. Rounds before 2024 are prose, not tables, and are not parsed.
# --------------------------------------------------------------------------
RCF_HEAD = re.compile(
    r"(?:January|July)\s*1\s*[\u2013-]\s*(?:June\s*30|December\s*31),\s*(\d{4})\s+In\s+([A-Z][a-z]+),\s+we distributed\s+\$([\d,]+)")


def parse_ace_rcf():
    path = os.path.join(RAW, "ace_rcf", "past.html")
    if not os.path.exists(path):
        return []
    h = re.sub(r"<script.*?</script>|<style.*?</style>", "", open(path, encoding="utf-8", errors="ignore").read(), flags=re.S)
    out = []
    for m in re.finditer(r"<table.*?</table>", h, re.S):
        heads = list(RCF_HEAD.finditer(collapse(strip_html(h[:m.start()]))))
        if not heads:
            continue
        period_year, month, said_total = int(heads[-1].group(1)), heads[-1].group(2).lower(), int(heads[-1].group(3).replace(",", ""))
        mo = MONTHS.get(month)
        if not mo:
            continue
        year = period_year + 1 if mo <= 2 else period_year
        got, table_total = [], None
        for gi, tr in enumerate(re.findall(r"<tr[^>]*>(.*?)</tr>", m.group(0), re.S)):
            cells = [collapse(strip_html(c)) for c in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", tr, re.S)]
            if len(cells) < 2:
                continue
            name, amt = cells[0], C.parse_money(cells[1])
            if name.lower().startswith("total"):
                table_total = amt
                continue
            if not amt or name.lower().startswith("recommended charity"):
                continue
            bullets = [b.strip() for b in (cells[3] if len(cells) > 3 else "").split("\u2022") if b.strip()]
            title = "Recommended Charity Fund grant" + (": " + clip(bullets[0], 170) if bullets else "")
            text = f"{name} {bullets[0] if bullets else ''}"
            got.append({
                "id": f"acercf:{year}-{mo:02d}:{gi}",
                "funder": "ACE Recommended Charity Fund",
                "fund": f"Recommended Charity Fund, {MON_ABBR[mo]} {year}",
                "grantee": name,
                "title": title,
                "amount_usd": amt,
                "date": f"{year}-{mo:02d}-01",
                "date_precision": "month",
                "year": str(year),
                "cause_area": C.CAUSE_ANIMAL,
                "tags": C.tags_join(C.tag_species(text), C.tag_region(text), C.tag_ai(text)),
                "is_regrant": False,
                "source_id": "ace_rcf",
                "source_url": "https://animalcharityevaluators.org/donate/donor-resources/recommended-charity-fund/past-distributions/",
                "retrieved_at": RETRIEVED,
            })
        total = sum(g["amount_usd"] for g in got)
        # Self-check: the per-charity rows must add up to the table's own Total row.
        if table_total is not None and abs(total - table_total) > 5:
            print(f"[ace_rcf] WARNING {MON_ABBR[mo]} {year}: parsed ${total:,} but the table's Total row says ${table_total:,}", file=sys.stderr)
        # The heading prose can disagree with the table (Aug 2026 does); we keep the table and say so.
        if abs(total - said_total) > 5:
            print(f"[ace_rcf] note {MON_ABBR[mo]} {year}: heading says ${said_total:,}, table totals ${total:,} (table used)", file=sys.stderr)
        out.extend(got)
    return out


def clip(s, n):
    return s if len(s) <= n else s[:n - 1].rstrip() + "\u2026"


# --------------------------------------------------------------------------
# Future of Life Institute grant programmes. One page per programme; each grant is an accordion row:
#   Project title | Amount recommended | [Primary investigator] | Details (summary).
# Programmes whose pages carry no year are dated from FLI's own announcements (noted below).
# Nuclear-war research and the AI-for-SDGs call are not AI safety and are not collected.
# --------------------------------------------------------------------------
FLI_PROGRAMS = {
    "2015-grant-program": ("2015 AI Safety Grant Program", "2015"),
    "2018-grant-program": ("2018 AGI Safety Grant Program", "2018"),
    "2021-grants": ("2021 Grants", "2021"),
    "2022-grants": ("2022 Grants", "2022"),
    "2023-grants": ("2023 Grants", "2023"),
    "2024-grants": ("2024 Grants", "2024"),
    "2025-grants": ("2025 Grants", "2025"),
    "mitigate-ai-driven-power-concentration": ("Mitigating AI-driven power concentration", "2024"),   # review rounds July and October 2024
    "global-institutions-governing-ai": ("Designs for global institutions governing AI", "2024"),      # "in 2024, FLI called for ..."
    "multistakeholder-engagement-for-safe-and-prosperous-ai": ("Multistakeholder engagement for safe and prosperous AI", "2025"),  # decisions June 2025
    "rfp-on-religious-projects": ("Religious projects tackling the AGI race", "2026"),                 # deadline 2 Feb 2026
}
FLI_ROW = re.compile(
    r"\s*(?P<title>.+?)\s+Amount recommended\s+\$(?P<amt>[\d,\.]+)\s*(?:Primary investigator\s+(?P<pi>.*?))?\s*"
    r"(?:Details\s*(?:Project Summary|Technical Abstract)?\s*(?P<body>.*)|No details available.*)", re.S)


def parse_fli():
    out = []
    for slug, (label, year) in FLI_PROGRAMS.items():
        path = os.path.join(RAW, "fli", slug + ".html")
        if not os.path.exists(path):
            continue
        h = re.sub(r"<script.*?</script>|<style.*?</style>", "", open(path, encoding="utf-8", errors="ignore").read(), flags=re.S)
        text = collapse(strip_html(h))
        for n, chunk in enumerate(re.split(r"\bProject title\b", text)[1:]):
            m = FLI_ROW.match(chunk)
            if not m:
                continue
            amt = C.parse_money("$" + m.group("amt"))
            pi = collapse(m.group("pi") or "")
            body = collapse(m.group("body") or "")
            body = re.split(r"\s(?:Sign up for the Future of Life|Commitment to nonviolence)", body)[0]
            title, grantee = collapse(m.group("title")), None
            if " , " in pi:                       # "Name , Institution": the institution receives the grant
                grantee, title = pi.split(" , ", 1)[1].strip(), title
            else:                                  # the "project title" is the recipient organisation
                grantee, title = title, clip(body, 170)
            if not grantee or not amt:
                continue
            out.append({
                "id": f"fli:{slug}:{n}",
                "funder": "Future of Life Institute",
                "fund": label,
                "grantee": grantee,
                "title": title,
                "amount_usd": amt,
                "date": f"{year}-01-01",
                "date_precision": "year",
                "year": year,
                "cause_area": C.CAUSE_AISAFETY,
                "tags": "",
                "is_regrant": False,
                "source_id": "fli",
                "source_url": f"https://futureoflife.org/grant-program/{slug}/",
                "retrieved_at": RETRIEVED,
            })
    return out


# --------------------------------------------------------------------------
# Coefficient Giving 'Global Catastrophic Risks Opportunities' fund (collected by hand in a browser).
# The fund mixes AI safety field-building, EA community building, biosecurity, climate engineering and more.
# A grant is filed under AI safety when its grantee or title mentions AI, or when the grantee is on the explicit
# list below of organisations that work on AI safety; animal grants (strict keyword) go to animal welfare; the
# rest is "other". Grants that are explicitly regranting are flagged and kept out of totals.
# --------------------------------------------------------------------------
CG_GCR_AI_ORGS = {
    "mats research", "pivotal research", "kairos", "bluedot impact", "constellation", "lightcone infrastructure",
    "meridian", "catalyze impact", "arcadia impact", "future impact group", "trajectory labs",
}


def parse_cg_gcr():
    path = os.path.join(RAW, "cg", "gcr.tsv")
    if not os.path.exists(path):
        return []
    seen = set()                       # rows that are also on CG's other two fund pages belong to those funds
    for other in ("faw.tsv", "tai.tsv"):
        p = os.path.join(RAW, "cg", other)
        if os.path.exists(p):
            with open(p, newline="", encoding="utf-8") as f:
                seen |= {(collapse(r["grantee"]), collapse(r["title"]), r["date"], r["amount"]) for r in csv.DictReader(f, delimiter="\t")}
    out = []
    with open(path, newline="", encoding="utf-8") as f:
        for i, r in enumerate(csv.DictReader(f, delimiter="\t")):
            grantee, title, amt = collapse(r["grantee"]), collapse(r["title"]), C.parse_money(r["amount"])
            if not grantee or not amt:
                continue
            if (grantee, title, r["date"], r["amount"]) in seen:
                print(f"[cg_gcr] dropped duplicate also on another CG fund page: {grantee} | {clip(title, 40)}", file=sys.stderr)
                continue
            text = f"{grantee} {title}"
            if STRICT_ANIMAL.search(text):
                cause = C.CAUSE_ANIMAL
            elif C.tag_cause(text) == C.CAUSE_AISAFETY or grantee.lower() in CG_GCR_AI_ORGS:
                cause = C.CAUSE_AISAFETY
            else:
                cause = C.CAUSE_OTHER
            date, prec = cg_date(r["date"])
            out.append({
                "id": f"cggcr:{date or i}:{i}",
                "funder": "Coefficient Giving",
                "fund": "Global Catastrophic Risks Opportunities",
                "grantee": grantee,
                "title": title,
                "amount_usd": amt,
                "date": date,
                "date_precision": prec,
                "year": date[:4] if date else "",
                "cause_area": cause,
                "tags": C.tags_join(C.tag_species(text), C.tag_ai(text)) if cause == C.CAUSE_ANIMAL else "",
                "is_regrant": bool(re.search(r"regrant", title, re.I)),
                "source_id": "cg_gcr",
                "source_url": "https://coefficientgiving.org/funds/global-catastrophic-risks-opportunities/",
                "retrieved_at": RETRIEVED,
            })
    return out


# --------------------------------------------------------------------------
# SFF Initiative Committee: gifts and grants made outside the main S-process rounds.
# Columns: Year | Source | Organization | Amount | Receiving Entity | Purpose
# --------------------------------------------------------------------------
def parse_sff_ic():
    path = os.path.join(RAW, "sff", "initiative_committee.html")
    if not os.path.exists(path):
        return []
    h = open(path, encoding="utf-8", errors="ignore").read()
    tbl = re.search(r"<table.*?</table>", h, re.S)
    if not tbl:
        return []
    out = []
    for n, tr in enumerate(re.findall(r"<tr[^>]*>(.*?)</tr>", tbl.group(0), re.S)):
        c = [collapse(strip_html(x)) for x in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", tr, re.S)]
        if len(c) < 6 or c[0] == "Year":
            continue
        year, source, org, amount, entity, purpose = c[:6]
        amt = C.parse_money(amount)
        grantee = _sff_grantee(entity, org)
        if not amt or not grantee or not re.fullmatch(r"\d{4}", year):
            continue
        text = f"{org} {purpose}"
        cause = C.tag_cause(text)
        if cause == C.CAUSE_OTHER:
            cause = C.CAUSE_AISAFETY       # same broad SFF rule as the main rounds (see methodology)
        out.append({
            "id": f"sffic:{year}:{n}",
            "funder": "SFF",
            "fund": "SFF Initiative Committee",
            "grantee": grantee,
            "title": purpose or org,
            "amount_usd": amt,
            "date": f"{year}-01-01",
            "date_precision": "year",
            "year": year,
            "cause_area": cause,
            "tags": C.tags_join(C.tag_species(text), C.tag_region(text), C.tag_ai(text)),
            "is_regrant": False,
            "source_id": "sff_ic",
            "source_url": "https://survivalandflourishing.fund/initiative-committee",
            "retrieved_at": RETRIEVED,
        })
    return out


# --------------------------------------------------------------------------
# NSF Safe Learning-Enabled Systems (SLES) awards, from the public NSF Awards API (scrapers/fetch_nsf.py).
# The programme is co-funded by Coefficient Giving; CG's transfer to NSF is flagged as a regrant on the CG side,
# so these downstream awards are counted once, here. Amount = funds obligated to date.
# --------------------------------------------------------------------------
def parse_nsf_sles():
    path = os.path.join(RAW, "nsf", "sles_awards.json")
    if not os.path.exists(path):
        return []
    out = []
    for a in json.load(open(path, encoding="utf-8")):
        amt = C.parse_money(a.get("fundsObligatedAmt"))
        name = collapse(a.get("awardeeName"))
        if not amt or not name:
            continue
        if name.isupper():
            name = name.title()
        if name.lower().endswith(", the"):
            name = "The " + name[:-5]
        mo, dy, yr = a["startDate"].split("/")
        title = re.sub(r"^Collaborative Research:\s*", "", collapse(a.get("title")))
        out.append({
            "id": f"nsf:{a['id']}",
            "funder": "National Science Foundation",
            "fund": "Safe Learning-Enabled Systems (co-funded by Coefficient Giving)",
            "grantee": name,
            "title": title,
            "amount_usd": amt,
            "date": f"{yr}-{mo}-{dy}",
            "date_precision": "day",
            "year": yr,
            "cause_area": C.CAUSE_AISAFETY,
            "tags": "",
            "is_regrant": False,
            "source_id": "nsf",
            "source_url": f"https://www.nsf.gov/awardsearch/showAward?AWD_ID={a['id']}",
            "retrieved_at": RETRIEVED,
        })
    return out


# --------------------------------------------------------------------------
# Open Wing Alliance Grants 2026 (table embedded in an EA Forum post)
# Columns: Organization | 2026 disbursement | Country and Region | Focus | Duration and award date
# --------------------------------------------------------------------------
def parse_owa():
    path = os.path.join(RAW, "owa", "post.html")
    if not os.path.exists(path):
        return []
    h = open(path, encoding="utf-8").read()
    tbl = re.search(r"<table.*?</table>", h, re.S)
    if not tbl:
        return []
    out = []
    for n, tr in enumerate(re.findall(r"<tr>(.*?)</tr>", tbl.group(0), re.S)):
        cells = [collapse(strip_html(c)) for c in
                 re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", tr, re.S)]
        if len(cells) < 5 or "disbursement" in cells[1].lower() or cells[0] == "Organization":
            continue
        org, disb, region, focus, when = cells[:5]
        amt = C.parse_money(disb)
        if not org or not amt:
            continue
        date, prec = ace_date(when)   # pulls "Month YYYY" out of e.g. "1 year March 2026"
        text = f"{org} {focus} {region}"
        cause = C.CAUSE_ANIMAL      # OWA is farm-animal (cage-free) work
        out.append({
            "id": f"owa:2026:{n}",
            "funder": "Open Wing Alliance",
            "fund": "OWA Grants 2026",
            "grantee": org,
            "title": focus or "Open Wing Alliance grant",
            "amount_usd": amt,
            "date": date or "2026-03-01",
            "date_precision": prec if date else "year",
            "year": (date or "2026")[:4],
            "cause_area": cause,
            "tags": C.tags_join(["chickens"] if re.search(r"cage.?free|hen|layer", focus, re.I) else [],
                                C.tag_species(text), C.tag_region(region)),
            "is_regrant": False,
            "source_id": "owa",
            "source_url": "https://forum.effectivealtruism.org/posts/LxWmmvij4dcDe5ins/open-wing-alliance-grants-2026-recommendations",
            "retrieved_at": RETRIEVED,
        })
    return out


# --------------------------------------------------------------------------
def main():
    parsers = [
        ("EA Funds", parse_ea_funds),
        ("Manifund", parse_manifund),
        ("SFF", parse_sff),
        ("ACE", parse_ace),
        ("CG", parse_cg),
        ("CG TAI", parse_cg_tai),
        ("CG GCR", parse_cg_gcr),
        ("SFF IC", parse_sff_ic),
        ("NSF", parse_nsf_sles),
        ("ACE RCF", parse_ace_rcf),
        ("FLI", parse_fli),
        ("OWA", parse_owa),
    ]
    rows = []
    for name, fn in parsers:
        got = fn()
        print(f"{name:12s} {len(got):5d} grants  ${sum(r['amount_usd'] for r in got):,.0f}",
              file=sys.stderr)
        rows.extend(got)

    # Exact-duplicate sentinel: the same grantee+title+date+amount appearing
    # more than once (across any source) is almost always a double count.
    seen = {}
    for r in rows:
        k = (r["grantee"].strip().lower(), r["title"].strip().lower(),
             r["date"], r["amount_usd"])
        seen.setdefault(k, []).append(r["source_id"])
    dups = {k: v for k, v in seen.items() if len(v) > 1}
    if dups:
        print(f"\n[dup check] {len(dups)} exact-duplicate key(s):", file=sys.stderr)
        for k, srcs in list(dups.items())[:10]:
            print(f"   x{len(srcs)} [{','.join(srcs)}] ${int(k[3]):,} {k[0][:30]} | {k[1][:30]}",
                  file=sys.stderr)
    else:
        print("\n[dup check] no exact duplicates", file=sys.stderr)

    rows.sort(key=lambda r: (r["date"] or "", -r["amount_usd"]))
    with open(OUT, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS)
        w.writeheader()
        for r in rows:
            r["is_regrant"] = "true" if r["is_regrant"] else "false"
            w.writerow(r)
    print(f"\nwrote {len(rows)} rows -> {OUT}", file=sys.stderr)


if __name__ == "__main__":
    main()
