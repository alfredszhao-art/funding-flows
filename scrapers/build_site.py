#!/usr/bin/env python3
"""Bake the CSVs in data/ into site/data.js so the static site works offline
(from file://) and on GitHub Pages without any server or fetch()."""
import csv
import datetime as dt
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DATA = os.path.join(ROOT, "data")
OUT = os.path.join(ROOT, "site", "data.js")


def read(name):
    path = os.path.join(DATA, name)
    if not os.path.exists(path):
        return []
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def main():
    grants = []
    for r in read("grants.csv"):
        grants.append({
            "funder": r["funder"],
            "fund": r["fund"],
            "grantee": r["grantee"],
            "title": r["title"],
            "amount": int(r["amount_usd"] or 0),
            "date": r["date"],
            "prec": r["date_precision"],
            "year": r["year"],
            "cause": r["cause_area"],
            "tags": [t for t in (r["tags"] or "").split(";") if t],
            "regrant": r["is_regrant"] == "true",
            "url": r["source_url"],
        })

    pipeline = []
    for r in read("pipeline.csv"):
        pipeline.append({
            "name": r["name"],
            "vehicle": r["vehicle"],
            "cause": r["cause_area"],
            "tier": r.get("tier", ""),
            "type": r["type"],
            "low": int(r["amount_low"] or 0),
            "high": int(r["amount_high"] or 0),
            "deadline": r.get("deadline", ""),
            "period": r["period"],
            "status": r["status"],
            "confidence": r["confidence"],
            "url": r["source_url"],
            "as_of": r["as_of"],
            "notes": r["notes"],
        })

    sources = [{
        "id": r["source_id"], "name": r["name"], "url": r["url"],
        "format": r["format"], "granularity": r["granularity"],
        "transparency": r["transparency"], "status": r["status"],
        "notes": r["notes"],
    } for r in read("sources.csv")]

    movement = [{
        "year": r["year"], "scope": r["scope"],
        "estimate": int(r["amount_usd_estimate"] or 0),
        "method": r["method"], "source": r["source"],
        "url": r["source_url"], "notes": r["notes"],
    } for r in read("movement_totals.csv")]

    payload = {
        "generated": dt.date.today().isoformat(),
        "grants": grants,
        "pipeline": pipeline,
        "sources": sources,
        "movement": movement,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        f.write("window.DATA = ")
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";\n")
    print(f"wrote {OUT}: {len(grants)} grants, {len(pipeline)} pipeline, "
          f"{len(sources)} sources, {len(movement)} movement rows")


if __name__ == "__main__":
    main()
