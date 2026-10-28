# Funding Flows

An open, reproducible tracker of **publicly disclosed animal-welfare
funding** — money already granted and money expected next.
Built to run locally first and to deploy to GitHub Pages later. Designed so it
can expand to AI safety.

> **Only publicly disclosed, named grants are included. Anonymized or redacted
> grants are never reverse-engineered** — in some regions, disclosed foreign
> funding can put grantees at risk.

## View it locally

The site is static and the data is baked into `site/data.js`, so you can open
it two ways:

```bash
# simplest: just open the file
open site/index.html

# or serve it (charts + tabs behave exactly as on GitHub Pages)
make serve        # -> http://localhost:8731
```

### Shareable views

The homepage has a domain switch (Animal welfare / AI safety). Any view can be linked with query parameters:

| parameter | values | effect |
|---|---|---|
| `domain` | `animal_welfare` (default), `ai_safety` | which domain the homepage headline and filters start in |
| `causes` | comma list of `animal_welfare`, `ai_safety`, `other` | which causes are shown (e.g. both) |
| `period` | `12m` (default), `all` | last 12 months or all time |
| `theme` | `light`, `dark` | colour scheme |

Example: `site/index.html?domain=ai_safety&period=all#funders`

## How it works

Fetching and parsing are kept **separate** so every number is reproducible:

```
data/raw/<source>/   raw snapshots (CSV / JSON / HTML), committed as-is
scrapers/            fetchers (download) + parsers (pure functions)
data/*.csv           the datasets (see below)
site/                the static website (index.html + styles.css + app.js + data.js)
```

### Datasets (`data/`)

| file | what |
|---|---|
| `grants.csv` | one row per disclosed grant (generated) |
| `pipeline.csv` | future money: pledges, open rounds, RFPs, projections (hand-maintained) |
| `sources.csv` | the source registry and collection status (hand-maintained) |
| `movement_totals.csv` | top-down whole-movement estimates (hand-maintained) |

`grants.csv` is **generated** — edit the parsers, not the file. The other three
are maintained by hand.

## Refreshing the data (monthly / quarterly)

```bash
make update     # fetch fresh snapshots, then rebuild grants.csv + data.js
# or step by step:
make fetch      # re-download EA Funds, SFF, ACE, Manifund (honest User-Agent)
make build      # parse raw/ -> grants.csv, then bake site/data.js  (no network)
```

Then commit `data/raw/`, `data/grants.csv` and `site/data.js`.

### The big gap: Coefficient Giving

Coefficient Giving (formerly Open Philanthropy) Farm Animal Welfare is the
**largest source and is not yet in the dataset** — it returns `403` to scripts.
Collect it by reading the grant pages in a real browser, or by requesting a CSV
from CG, and save it to `data/raw/cg/faw.tsv`, then add a parser. Until then,
**all animal-welfare totals are a substantial undercount** and the site says so.

We do **not** spoof a browser User-Agent or extract API keys from page JS to get
around the block.

## Deploy to GitHub Pages

1. Create a repo and push this directory.
2. In **Settings → Pages**, set the source to **GitHub Actions**.
3. The workflows in `.github/workflows/` refresh the data weekly and publish
   the `site/` folder.

## Conventions

- Honest User-Agent on every request: `funding-flows-research/0.1 (open-data project)`.
- Regrants (money passed to another grantmaker) are flagged `is_regrant` and
  excluded from funder/cause totals to avoid double counting.
- Parsers run with no third-party dependencies (standard library only).

## License

The code is released under the MIT License (see `LICENSE`). The data is compiled from public pages and APIs;
each row links to its source, and the source's own terms apply to the underlying records.
