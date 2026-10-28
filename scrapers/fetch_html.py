#!/usr/bin/env python3
"""Fetch the HTML snapshots for SFF and ACE Movement Grants.

Honest User-Agent only. We never spoof a browser UA or pull API keys out of
page JS; sources that block scripts (e.g. Coefficient Giving) are collected
manually in a browser instead.
"""
import os
import sys
import time
import urllib.request

UA = "funding-flows-research/0.1 (open-data project)"
HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(os.path.dirname(HERE), "data", "raw")

TARGETS = {
    # ACE Movement Grants — all past rounds on one page.
    "ace/past.html": "https://animalcharityevaluators.org/movement-grants/past-movement-grants-recipients/",
    # ACE Recommended Charity Fund: per-charity distributions, one table per round.
    "ace_rcf/past.html": "https://animalcharityevaluators.org/donate/donor-resources/recommended-charity-fund/past-distributions/",
    # Future of Life Institute: one page per grant programme (the same list as FLI_PROGRAMS in build_grants.py).
    **{f"fli/{slug}.html": f"https://futureoflife.org/grant-program/{slug}/" for slug in (
        "2015-grant-program", "2018-grant-program", "2021-grants", "2022-grants", "2023-grants", "2024-grants", "2025-grants",
        "mitigate-ai-driven-power-concentration", "global-institutions-governing-ai",
        "multistakeholder-engagement-for-safe-and-prosperous-ai", "rfp-on-religious-projects")},
    # Open Wing Alliance Grants 2026 — table embedded in an EA Forum post.
    "owa/post.html": "https://forum.effectivealtruism.org/posts/LxWmmvij4dcDe5ins/open-wing-alliance-grants-2026-recommendations",
    # SFF recommendation rounds. Older rounds are half-yearly (h1/h2).
    "sff/recs_2019.html": "https://survivalandflourishing.fund/2019/recommendations",
    "sff/recs_2020_h1.html": "https://survivalandflourishing.fund/2020/h1/recommendations",
    "sff/recs_2020_h2.html": "https://survivalandflourishing.fund/2020/h2/recommendations",
    "sff/recs_2021_h1.html": "https://survivalandflourishing.fund/2021/h1/recommendations",
    "sff/recs_2021_h2.html": "https://survivalandflourishing.fund/2021/h2/recommendations",
    "sff/recs_2022_h1.html": "https://survivalandflourishing.fund/2022/h1/recommendations",
    "sff/recs_2022_h2.html": "https://survivalandflourishing.fund/2022/h2/recommendations",
    "sff/recs_2023_h1.html": "https://survivalandflourishing.fund/2023/h1/recommendations",
    "sff/recs_2023_h2.html": "https://survivalandflourishing.fund/2023/h2/recommendations",
    "sff/recs_2024.html": "https://survivalandflourishing.fund/2024/recommendations",
    "sff/recs_2025.html": "https://survivalandflourishing.fund/2025/recommendations",
    "sff/recs_2026.html": "https://survivalandflourishing.fund/2026/recommendations",
}


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=90) as r:
        return r.read()


def main():
    for rel, url in TARGETS.items():
        out = os.path.join(RAW, rel)
        os.makedirs(os.path.dirname(out), exist_ok=True)
        try:
            data = fetch(url)
            with open(out, "wb") as f:
                f.write(data)
            print(f"ok   {len(data):>8,}  {rel}", file=sys.stderr)
        except Exception as e:  # noqa: BLE001 - report and continue
            print(f"FAIL {rel}: {e}", file=sys.stderr)
        time.sleep(1.0)


if __name__ == "__main__":
    main()
