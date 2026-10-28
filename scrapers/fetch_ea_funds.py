#!/usr/bin/env python3
"""Fetch the EA Funds grants database as CSV (AWF / LTFF / EAIF / GHD)."""
import os
import sys
import urllib.request

UA = "funding-flows-research/0.1 (open-data project)"
URL = "https://funds.effectivealtruism.org/api/grants"
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(HERE), "data", "raw", "ea_funds", "grants.csv")


def main():
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    req = urllib.request.Request(URL, headers={"User-Agent": UA, "Accept": "text/csv"})
    with urllib.request.urlopen(req, timeout=90) as r:
        data = r.read()
    with open(OUT, "wb") as f:
        f.write(data)
    print(f"saved {len(data):,} bytes -> {OUT}", file=sys.stderr)


if __name__ == "__main__":
    main()
