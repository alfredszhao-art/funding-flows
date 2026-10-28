"""Fetch all Manifund projects via the public API (paginated by created_at)."""
import json, sys, time, urllib.request, pathlib

UA = "funding-flows-research/0.1 (open-data project)"
API = "https://manifund.org/api/v0/projects"

def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=90) as r:
        return json.load(r)

def main(out_dir):
    out = pathlib.Path(out_dir); out.mkdir(parents=True, exist_ok=True)
    allp, before = [], None
    while True:
        url = API + (f"?before={before}" if before else "")
        page = get(url)
        if not page:
            break
        allp.extend(page)
        before = page[-1]["created_at"]
        print(len(allp), before, file=sys.stderr)
        if len(page) < 100:
            break
        time.sleep(1.0)
    # Drop the free-text project description: we never use it, and it contains third parties' email addresses.
    allp = [{k: v for k, v in p.items() if k != "description"} for p in allp]
    (out / "projects_all.json").write_text(json.dumps(allp, ensure_ascii=False))
    print(f"saved {len(allp)} projects", file=sys.stderr)

if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "data/raw/manifund")
