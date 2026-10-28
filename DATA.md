# Data dictionary & source provenance

Everything here is built from the raw snapshots in `data/raw/`. Every single
grant row is traceable to its source: it carries a `source_id`, a `source_url`,
and the `retrieved_at` date of the snapshot it came from.

## Files

| file | rows | generated? | what |
|---|---|---|---|
| `data/grants.csv` | 4,621 | **generated** by `scrapers/build_grants.py` | one row per disclosed grant |
| `data/pipeline.csv` | 28 | hand-maintained | future money, with a `tier` (open_call / committed / capacity / projection) and `deadline` |
| `data/sources.csv` | 25 | hand-maintained | the source registry + collection status |
| `data/movement_totals.csv` | 4 | hand-maintained | top-down whole-movement estimates |

Do **not** edit `grants.csv` by hand — change the parser and rebuild.

## `grants.csv` columns

| column | meaning |
|---|---|
| `id` | stable id, prefixed by source (`cg:…`, `cgtai:…`, `cggcr:…`, `sffic:…`, `nsf:…`, `eafunds:…`, `manifund:…`, `sff:…`, `ace:…`, `acercf:…`, `fli:…`, `owa:…`) |
| `funder` | who gave the money (Coefficient Giving, EA Funds, SFF, ACE Movement Grants, ACE Recommended Charity Fund, Future of Life Institute, Manifund, Open Wing Alliance) |
| `fund` | the specific fund / round (e.g. "Farm Animal Welfare", "Animal Welfare Fund", "SFF 2026 round") |
| `grantee` | who received it |
| `title` | purpose / description, as published |
| `amount_usd` | grant amount in USD (integer) |
| `date` | ISO date; see `date_precision` for how exact it is |
| `date_precision` | `month` / `quarter` / `year` / `created` / `unknown` — how precise `date` is |
| `year` | calendar year |
| `cause_area` | `animal_welfare` / `ai_safety` / `digital_minds` / `other`. Grants about both AI and animals are `animal_welfare` (AI × animals is not its own cause) and carry an `ai` tag. `ai_safety` is broad: AI safety, governance and the existential-risk work that SFF and the Long-Term Future Fund fund |
| `tags` | species / region / `ai` tags, `;`-separated, best-effort from keywords |
| `is_regrant` | `true` if the money was passed to another grantmaker (excluded from totals — see below) |
| `source_id` | which source registry entry this came from |
| `source_url` | the public page the data was read from |
| `retrieved_at` | date the raw snapshot was taken |

## Sources currently in `grants.csv`

| funder | source_id | grants | coverage | how it's fetched |
|---|---|---|---|---|
| Coefficient Giving (ex–Open Philanthropy) — Farm Animal Welfare | `cg` | 635 | 2016–2026 | **manual**: the page returns 403 to scripts, so the paginated table is read in a real browser → `data/raw/cg/faw.tsv` |
| Coefficient Giving — Navigating Transformative AI | `cg_tai` | 639 | 2015–2026 | **manual**, same method → `data/raw/cg/tai.tsv`. 640 rows on the page; one that CG lists on both of its fund pages is kept only under the farm animal fund |
| Coefficient Giving — Global Catastrophic Risks Opportunities | `cg_gcr` | 300 | 2015–2026 | **manual**, same method → `data/raw/cg/gcr.tsv`. A mixed fund, so each grant is classified: AI safety if the grantee or title mentions AI or the grantee is on the explicit list `CG_GCR_AI_ORGS` in `build_grants.py` (MATS, Pivotal, Kairos, BlueDot, Constellation, Lightcone, Meridian, Catalyze, Arcadia Impact, Future Impact Group, Trajectory Labs); animal if it names animals; otherwise `other` (EA community building, biosecurity, climate engineering) |
| EA Funds (AWF / LTFF / EAIF / GHD) | `ea_funds` | 1,697 | 2017–2026 | official CSV API (`scrapers/fetch_ea_funds.py`) |
| Survival and Flourishing Fund | `sff` | 634 | 2019–2026 (2020–2023 half-yearly) | HTML pages (`scrapers/fetch_html.py`) |
| SFF Initiative Committee | `sff_ic` | 28 | 2024 | HTML table (`scrapers/fetch_html.py`): gifts and grants outside the main rounds, mostly Jaan Tallinn's |
| Manifund | `manifund` | 278 | to 2026 | public JSON API; animal-welfare, falcon-fund and digital-minds causes, the AI causes (`tais`, `ai-gov`, `ais-fieldbuilding`, `ais-advocacy`, `grantmaking-ai`, `ai-worldviews`), `gcr` projects only when they are about AI, and a few animal projects filed under other causes (`scrapers/fetch_manifund.py`) |
| ACE Movement Grants | `ace` | 153 | all rounds | HTML page (`scrapers/fetch_html.py`) |
| ACE Recommended Charity Fund | `ace_rcf` | 64 | six rounds, Jan 2024 – Aug 2026 | HTML tables, one per round (`scrapers/fetch_html.py`). Dated by the month the money was paid out. The parser checks each round against the table's own Total row |
| Future of Life Institute | `fli` | 131 | 2015–2026 | one HTML page per programme, 11 programmes (`scrapers/fetch_html.py`). Each programme's count equals the count its own page states. Programme pages with no year are dated from FLI's announcements: power concentration 2024 (review rounds Jul and Oct 2024), global-institutions designs 2024, multistakeholder 2025 (decisions Jun 2025), religious-projects RFP 2026 (deadline 2 Feb 2026) |
| NSF Safe Learning-Enabled Systems | `nsf` | 34 | 2023–2025 | NSF Awards API (`scrapers/fetch_nsf.py`). Co-funded by Coefficient Giving, whose transfer to NSF is flagged as a regrant, so the money is counted once. Amount is funds obligated to date. The fetcher keeps organisation-level fields only: the API can ignore its field list and return researchers' emails and phone numbers |
| Open Wing Alliance Grants 2026 | `owa` | 28 | 2026 | table in an EA Forum post (`scrapers/fetch_html.py`) |

## Checked and not usable (and why)

Looked at while searching for more animal-welfare data. Each is also in `data/sources.csv` with its status.

| source | why it is not in `grants.csv` |
|---|---|
| The Navigation Fund | publishes no grant list (states >$60M/yr across all areas; receives regrants from CG) |
| Strategic Animal Funding Circle (Senterra) | rounds 1–2 (2025) gave about $900k to 16 organisations; the post names the organisations but not each amount |
| GFI research grants | `gfi.org/grants` lists ~140 projects by title but no amount or year per grant |
| Founders Pledge grantee pages | organisation names only, no amounts or dates |
| FarmKind | publishes how donations are split, not per-charity amounts |
| Good Ventures grants database | the old address now redirects to a page with no list or CSV; archived pages stop around 2021 and mostly duplicate Coefficient Giving's list |
| EA Funds payout reports | narrative highlights, not full lists; used only as a cross-check (see caveats) |
| EA Funds Transformative AI fund page | no grant list on the page, and the EA Funds grants API has no records under that name (its AI grants are the Long-Term Future Fund's) |
| Trace (trace.manifund.org) | a secondary aggregator ($13.7B in 3,519 funder × recipient × year records, no per-grant title or source link, large 'Unknown Recipients' blocks); used only as a coverage check. It shows funders with no grant list here (Longview about $420M, Macroscopic about $130M, Schmidt Sciences about $88M) and higher Coefficient Giving AI totals than our collection, so treat our CG AI figures as a lower bound |
| vipulnaik/donations | 211,118 rows but none dated 2023 or later; the funders we track stop at 2018–2019, so it only helps with pre-2019 history |
| ProPublica Nonprofit Explorer | returns financial summaries and PDF links, not filing XML; grant-level Schedule I data would need the IRS e-file bulk data |
| UK AISI Alignment Project | over £27M to over 60 projects (2026), but no per-project list or amounts |
| UK AISI Systemic Safety Grants | 20 seed grants of up to £200k; only a few awardees named, no amounts |
| Schmidt Sciences AI Safety Science | 48 funded projects by title; no institutions or amounts |
| AI Safety Fund (Frontier Model Forum) | two rounds (Nov 2024, Dec 2025); no grantee list with amounts on its own site |

Leads still open: Cooperative AI Foundation grant summaries (the page renders in the browser only), Wild Animal Initiative grant announcements (per-grant amounts are inside individual blog posts), and 990-based data for private foundations such as Karuna.

## Deduplication & double-counting policy

Three distinct things, handled separately:

1. **Exact duplicate rows.** The same `grantee + title + date + amount` appearing
   twice is almost always a double count. `build_grants.py` prints a **dup-check**
   on every run.
   - Fixed: the EA Funds API appends a `grantsAddonData[*]` block that re-listed
     2 grants ($60k) which already had real records — those are now dropped.
   - Fixed: one grant (Humane Society International, $650,000, May 2021) appears on both of Coefficient Giving's fund pages; it is kept only under the farm animal fund.
   - Remaining & surfaced: **3** cases ($120k total) where a funder's own data
     lists identical grantee + purpose + amount twice in the same round (one in
     EA Funds, two in SFF 2020 — SFF can make several recommendations with the
     same surface values). We keep both (we don't silently delete a funder's own
     records) and the dup-check keeps them visible each build.

2. **Regrants (money passed funder → funder).** A grant to an intermediary that
   re-grants the money is flagged `is_regrant = true` and **excluded from all
   overview totals and charts** so it isn't counted twice. 26 rows are flagged
   (23 of them in CG: the Navigation Fund Cage-Free Implementation Fund $10M +
   $1.5M, Spring Innovation Fund $7.5M + $3.5M, Founders Pledge $1.8M, the AI &
   Animals Regranting Fund $100k, and other explicit regranting grants; plus the
   Manifund Falcon Fund and 2 EA Funds regrants; and, on CG's AI fund, FAR AI's $12M "AI Safety Regranting", an NSF programme ($5M) and a Longview RFP ($4M), which are listed explicitly in `CG_TAI_PASSTHROUGH` so every flag can be audited; plus five EA Funds regranting grants on CG's Global Catastrophic Risks fund, $24.3M). The grants table still shows
   them, marked.

3. **Same grantee, different funders — NOT a duplicate.** 196 organisations
   appear under more than one funder (e.g. Anima International gets money from
   both Coefficient Giving and EA Funds). These are genuinely separate grants of
   separate money and are all kept. No cross-funder "dedup" is applied, because
   the same grant does not appear on two different funders' lists.

## Recency

The site's default view is the **last 12 months**: the 12 calendar months ending with the
snapshot month (Nov 2025 – Oct 2026 for the 2026-10-28 snapshot). Funders publish dates at
different precision (CG a month, EA Funds a quarter, SFF a round, Manifund only the project's
creation), so a grant known only to a quarter or round sits at the start of it and a few fall in
or out of the window by convention. `date_precision` records which.

## Privacy in the raw snapshots

The Manifund snapshot keeps every field except the free-text project `description`. We never use it, and it
contains third parties' email addresses, so neither the fetcher nor the committed snapshot keeps it.

## Known accuracy caveats

- EA Funds 2019–2020 are incomplete; 2025 AWF here is below AWF's self-reported figure.
  The AWF payout reports give a total *approved* per period (Apr–Jun 2025 $1.35M, Jul–Dec 2025
  $2.48M) that does not match the grants database either way (database: Q2 2025 $0.50M,
  Q3+Q4 2025 $3.32M), so the gap is a difference in what is counted, not simply missing rows.
- ACE Recommended Charity Fund, Aug 2026: the heading text says $1,293,213 but the table totals
  $1,365,823 (its percentages are computed on the larger figure). The table is used.
- SFF is bucketed broadly: its non-animal grants (and the Long-Term Future Fund)
  are shown under `ai_safety`.
- Manifund exposes amounts without a grant date, so project creation date is used.
- `cause_area`, species and region tags are keyword-based and best-effort.
