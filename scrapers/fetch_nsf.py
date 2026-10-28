#!/usr/bin/env python3
"""Fetch NSF awards for the Safe Learning-Enabled Systems (SLES) programme from the public NSF Awards API.

SLES is an NSF programme that Coefficient Giving co-funds; the CG -> NSF transfer is flagged as a regrant in
the CG AI fund data, so these downstream awards are the ones that count. We keep awards whose title starts
with "SLES:" (including "Collaborative Research: SLES: ...") and save the fields we use, without abstracts, contacts or PI names.
"""
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

UA = "funding-flows-research/0.1 (open-data project)"
API = "https://api.nsf.gov/services/v1/awards.json"
FIELDS = "id,title,awardeeName,awardeeStateCode,fundsObligatedAmt,estimatedTotalAmt,startDate,expDate,fundProgramName"
# The API can ignore printFields (it does when paging) and return whole records with researchers' and programme
# officers' emails and phone numbers. Keep only these organisation-level fields before anything is written.
KEEP = ("id", "title", "awardeeName", "awardeeStateCode", "fundsObligatedAmt", "estimatedTotalAmt", "startDate", "expDate", "fundProgramName")
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(HERE), "data", "raw", "nsf", "sles_awards.json")


def get(params):
    url = API + "?" + urllib.parse.urlencode({**params, "printFields": FIELDS, "rpp": 100})
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=90) as r:
        return json.load(r)["response"].get("award", [])


def paged(params):
    out, offset = [], 1
    while True:
        page = get({**params, "offset": offset})
        out.extend(page)
        if len(page) < 100:
            return out
        offset += 100
        time.sleep(1.0)


def main():
    found = {}
    for params in ({"fundProgramName": "AI-Safety"}, {"keyword": "SLES"}):
        for a in paged(params):
            if re.search(r"\bSLES\s*:", a.get("title", "")):
                found[a["id"]] = {k: a.get(k, "") for k in KEEP}
        time.sleep(1.0)
    awards = sorted(found.values(), key=lambda a: (a["startDate"][-4:], a["startDate"][:2], a["id"]))
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(awards, f, ensure_ascii=False, indent=0)
    total = sum(int(a["fundsObligatedAmt"]) for a in awards)
    print(f"saved {len(awards)} SLES awards, ${total:,} obligated -> {OUT}", file=sys.stderr)


if __name__ == "__main__":
    main()
