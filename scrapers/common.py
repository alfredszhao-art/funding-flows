"""Shared helpers for the funding-flows parsers: cause/species/region tagging."""
import re

# ---- cause area -----------------------------------------------------------
# Primary cause assigned to each grant. Order of this list is the priority used
# when several signals match (first match wins).
CAUSE_ANIMAL = "animal_welfare"
CAUSE_DIGITAL = "digital_minds"
CAUSE_AISAFETY = "ai_safety"
CAUSE_OTHER = "other"

CAUSE_LABELS = {
    CAUSE_ANIMAL: "Animal welfare",
    CAUSE_DIGITAL: "Digital minds",
    CAUSE_AISAFETY: "AI safety",
    CAUSE_OTHER: "Other / meta",
}

_ANIMAL_KW = re.compile(
    r"\b(animal|welfare|chicken|hen|cage[- ]?free|broiler|layer|poultry|fish|"
    r"shrimp|crustacean|lobster|crab|aquatic|aquaculture|farmed|livestock|"
    r"cattle|pig|swine|cow|dairy|veal|meat|vegan|plant[- ]?based|"
    r"alt(ernative)?[- ]?protein|cultivated|cellular agriculture|slaughter|"
    r"humane|insect|wild animal|sentience|carp|salmon|bee|snail|octopus)s?\b",
    re.I,
)
_AI_KW = re.compile(
    r"\b(ai|a\.i\.|artificial intelligence|machine learning|\bml\b|llm|"
    r"alignment|agentic|foundation model|frontier model)\b",
    re.I,
)


def tag_cause(text, hint=None):
    """Return a primary cause area for a free-text grant description.

    `hint` can force a bucket (e.g. a known fund). Otherwise we infer from
    keywords: animal -> animal_welfare (AI mentions are kept as an `ai` tag, see tag_ai),
    AI/alignment -> ai_safety, else other.
    """
    if hint:
        return hint
    t = text or ""
    animal = bool(_ANIMAL_KW.search(t))
    ai = bool(_AI_KW.search(t))
    if animal:
        return CAUSE_ANIMAL
    if ai:
        return CAUSE_AISAFETY
    return CAUSE_OTHER


def tag_ai(text):
    """["ai"] when a grant is about animals AND AI, so it stays findable now that
    AI x animals is no longer its own cause area."""
    t = text or ""
    return ["ai"] if (_ANIMAL_KW.search(t) and _AI_KW.search(t)) else []


# ---- species tags ---------------------------------------------------------
_SPECIES = [
    ("chickens", r"\b(chicken|hen|broiler|layer|poultry|egg)s?\b"),
    ("fish", r"\b(fish|salmon|carp|trout|aquaculture|finfish)e?s?\b"),
    ("shrimp", r"\b(shrimp|prawn)s?\b"),
    ("crustaceans", r"\b(crustacean|lobster|crab|decapod)s?\b"),
    ("pigs", r"\b(pig|swine|piglet|sow)s?\b"),
    ("cattle", r"\b(cattle|cow|dairy|beef|veal)s?\b"),
    ("insects", r"\b(insect|bee|cricket|mealworm|black soldier)s?\b"),
    ("wild", r"\b(wild animal|wild[- ]?life|wild[- ]?caught)s?\b"),
    ("aquatic", r"\b(aquatic|fish|shrimp|crustacean|octopus|mollusc)s?\b"),
]


def tag_species(text):
    t = text or ""
    out = []
    for name, pat in _SPECIES:
        if re.search(pat, t, re.I):
            out.append(name)
    return out


# ---- region tags (best effort, by country keyword) ------------------------
_REGION = [
    ("Europe", r"\b(EU|Europe|European|UK|Britain|Czech|Poland|Polish|Spain|"
               r"Spanish|Italy|Italian|France|French|Germany|German|Netherlands|"
               r"Dutch|Portugal|Nordic|Baltic|Ukraine)\b"),
    ("North America", r"\b(US|U\.S\.|USA|United States|America|American|Canada|Canadian|Mexico|Mexican)\b"),
    ("Asia", r"\b(China|Chinese|India|Indian|Japan|Korea|Vietnam|Thailand|"
             r"Indonesia|Philippines|Asia|Asian|Taiwan|Hong Kong)\b"),
    ("Latin America", r"\b(Brazil|Brazilian|Argentina|Chile|Colombia|Peru|Latin America|LatAm)\b"),
    ("Africa", r"\b(Africa|African|Nigeria|Kenya|Kenyan|Ghana|South Africa|Uganda)\b"),
]


def tag_region(text):
    t = text or ""
    out = []
    for name, pat in _REGION:
        if re.search(pat, t, re.I):
            out.append(name)
    return out


# ---- misc -----------------------------------------------------------------
def parse_money(s):
    """Extract the first dollar amount from a string -> int (USD), or None."""
    if s is None:
        return None
    m = re.search(r"\$\s*([\d,]+(?:\.\d+)?)", str(s))
    if not m:
        m = re.search(r"([\d,]{2,}(?:\.\d+)?)", str(s))
        if not m:
            return None
    try:
        return int(round(float(m.group(1).replace(",", ""))))
    except ValueError:
        return None


def tags_join(*lists):
    seen, out = set(), []
    for lst in lists:
        for x in lst:
            if x not in seen:
                seen.add(x)
                out.append(x)
    return ";".join(out)
