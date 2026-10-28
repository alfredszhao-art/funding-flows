# Funding Flows — build + refresh
PY ?= python3
PORT ?= 8731

.PHONY: build fetch update serve clean

## build: parse raw snapshots -> grants.csv and bake site/data.js (no network)
build:
	$(PY) scrapers/build_grants.py
	$(PY) scrapers/build_site.py

## fetch: re-download the script-accessible sources (EA Funds, SFF, ACE, Manifund)
fetch:
	$(PY) scrapers/fetch_ea_funds.py
	$(PY) scrapers/fetch_html.py
	$(PY) scrapers/fetch_manifund.py data/raw/manifund

## update: fetch fresh data then rebuild everything
update: fetch build

## serve: view the site locally at http://localhost:$(PORT)
serve:
	@echo "Serving site/ at http://localhost:$(PORT) — Ctrl-C to stop"
	@cd site && $(PY) -m http.server $(PORT)

clean:
	rm -f data/grants.csv site/data.js
