# Felis

An interactive atlas of recorded occurrences of the cat genus *Felis*, built from
[GBIF](https://www.gbif.org) biodiversity data.

The map is the product. It answers one question, **where have cats from the genus
*Felis* been recorded?**, and nothing else.

> **A note on what this data means.** GBIF occurrence records show where organisms
> have been *recorded in available datasets*. They are not a population estimate,
> a range map, or a habitat model. About 75% of the records are *Felis catus*, the
> domestic cat, so much of the map reflects where people observe and report
> animals rather than where cats live. The interface uses "recorded occurrences"
> throughout for this reason.

## Tech stack

| Layer | Choice |
| --- | --- |
| UI | React 18 + TypeScript |
| Build | Vite 6 |
| Runtime / package manager | Bun |
| Map | Mapbox GL JS 3 |
| Data pipeline | Python 3 (standard library only) |
| Data source | GBIF Occurrence + Species APIs |

There is **no backend**. See [Architecture](#architecture) for why.

## Setup

Requires [Bun](https://bun.sh) and Python 3.9+.

```bash
bun install
```

Copy the environment template and add a Mapbox token:

```bash
cp .env.example .env
```

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `VITE_MAPBOX_TOKEN` | yes | Mapbox GL JS access token (`pk.…`) |

No GBIF credentials are needed. Everything this project reads from GBIF is public
and unauthenticated.

## Development

Generate the dataset once, then start the dev server:

```bash
bun run data:all
```

```bash
bun run dev
```

The app runs at http://localhost:3250.

## Data pipeline

```
GBIF Occurrence API
        │  scripts/gbif/fetch.py
        ▼
data/raw/occurrences.jsonl.gz          trimmed records, one per line
        │  scripts/processing/build.py
        ▼
public/data/occurrences.json           packed coordinates, all records
public/data/species.json               species list, counts, dataset date
data/processed/report.json             what was excluded and why
```

Run the steps separately if you prefer:

```bash
bun run data:fetch
```

```bash
bun run data:process
```

`data/raw/`, `data/processed/` and `public/data/` are gitignored. The pipeline is
reproducible, so regenerate rather than commit. A full fetch takes roughly an hour
and is dominated by GBIF's response time on deep result offsets.

### Acquisition

`fetch.py` pulls genus *Felis* (GBIF backbone key **2435022**) filtered to
`hasCoordinate=true` and `hasGeospatialIssue=false`.

Two constraints shape it:

- **GBIF rejects any offset above 100,001.** The genus has ~289k mappable records
  and *Felis catus* alone has ~216k, so neither can be paged in one query. The
  script slices by country instead. Because `hasCoordinate=true` makes GBIF
  backfill `country` from the coordinates, country slices cover 100.00% of the
  filtered set, and the largest (Australia, ~69k) stays under the ceiling. Any
  slice that did exceed it is sub-sliced by decade automatically.
- **Paging a country serially is slow.** Facet counts give every slice's size up
  front, so all pages are expanded into a flat list and fetched concurrently.

> The genus page on gbif.org uses the identifier `4JQ8`. That is a
> ChecklistBank/Catalogue of Life id and the v1 occurrence API **silently returns
> zero results** for it rather than erroring. Use `2435022`.

### Processing rules

`build.py` applies these in order and reports the count excluded by each in
`data/processed/report.json`:

| Rule | Reason |
| --- | --- |
| GBIF filter `hasCoordinate=true`, `hasGeospatialIssue=false` | applied at query time |
| drop missing latitude or longitude | not mappable |
| drop coordinates outside `[-90,90]` / `[-180,180]` | invalid |
| drop exact `(0,0)` | "null island", a failed geocode rather than a location |
| drop duplicate occurrence keys | deep paging can repeat a record |
| drop records with no `speciesKey` | identified to genus only |

Nothing else is deleted. Two categories are **kept and flagged** instead:

- **Palaeontological records** are hidden behind a toggle that is off by default.
  *Felis atrox* is a Pleistocene animal and should not sit unlabelled beside a
  phone photo from last year.
- **Low-precision records** are tiered by `coordinateUncertaintyInMeters` rather
  than filtered. Median uncertainty is ~20 m but the 90th percentile is ~27 km, so
  a single dot size for every record would imply precision most do not have.

| Tier | Uncertainty | Rendering |
| --- | --- | --- |
| 0 | 1 km or better | small bright paw |
| 1 | 1 to 10 km | medium, dimmer paw |
| 2 | coarser than 10 km, or unrecorded | large faint paw |

#### Identifying extinct taxa

`basisOfRecord` alone is **not** a reliable palaeontology filter. Only 79 of 136
*Felis atrox* records are tagged `FOSSIL_SPECIMEN`. The rest are
`MATERIAL_CITATION`, `PRESERVED_SPECIMEN` or `MATERIAL_SAMPLE`, and *Felis
studeri*, also extinct, has none at all. Filtering on that field alone would leave
Pleistocene material sitting in the modern map.

So extinction is taken from GBIF's own `/species/{key}/speciesProfiles` endpoint,
which states it directly. Where GBIF has no profile, it falls back to the record
mix: a taxon whose records are mostly `FOSSIL_SPECIMEN` is treated as
palaeontological. Every record of an extinct taxon is then flagged, regardless of
its own `basisOfRecord`.

Each species carries `extinctSource` in `species.json` so you can see which rule
applied. The fallback is deliberately conservative. *Felis youngi* (one record,
no GBIF profile, no fossil tag) is not flagged, and would need a profile from GBIF
to be caught.

Currently 8 of 20 taxa are flagged extinct, covering 265 records. In the interface
these sit behind a "Show ancient cats" toggle.


## Architecture

```
GBIF Occurrence API ──► fetch.py ──► build.py ──► static JSON
                                                      │
                                                      ▼
                                            React + Mapbox GL JS
                                                      │
                     GBIF Occurrence API ◄────────────┘
                     (live, on point click)
```

Two decisions are worth knowing before you change anything.

**The whole dataset is one static file.** ~289k records reduce to ~11 MB of packed
JSON, which every static host gzips to ~3.6 MB on the wire. That is small enough
that vector tiles, PMTiles, DuckDB and Parquet would all add a build step and a
binary dependency to solve a problem this project does not have. Reach for tiles
if the dataset grows past a couple of million points, for example if you extend
beyond *Felis*.

**Occurrence detail is fetched live, not bundled.** Clicking a point calls
`https://api.gbif.org/v1/occurrence/{key}` directly from the browser. This keeps
the bundled file to geometry only and keeps media URLs, licences and rights
holders current instead of frozen at build time. GBIF sends
`access-control-allow-origin: *`, so no proxy is required.

Together those two points are why there is no backend. Both GBIF endpoints are
public, CORS-enabled and need no credentials, and the dataset is a static file, so
a server would have nothing to do. If you later want server-side filtering,
caching or API-key protection, adding [Hono](https://hono.dev) in `server/` is a
small change. Nothing in the frontend assumes its absence beyond the fetch URLs
in `src/lib/`.

### Map rendering

Occurrences are drawn as cat paw prints, each rotated by its own record key so a
dense area reads as scattered tracks rather than a grid of identical marks. The
icons are emoji painted to a canvas and recoloured through their own alpha: a paw
glyph renders almost black, which is invisible on a dark map, and colour emoji
fonts are missing on some platforms. Recolouring gives one look everywhere.

Clicks and hovers come from separate invisible layers, a wide circle under each
paw and the glow circle under each cluster, because a paw is an awkward shape to
hit precisely on a phone. Hovering either shows a small readout: the record count
for a cluster, the cat's common name and year for a single sighting.

One Mapbox GeoJSON source with clustering enabled:

| Zoom | Behaviour |
| --- | --- |
| 0 to 9 | clustered; a paw print and count, both scaling with the number of records |
| 9+ | one paw print per record; size and opacity encode the precision tier |

Filtering rebuilds the source via `setData` rather than using `setFilter`. With
`cluster: true` a layer filter is applied *after* clustering, so cluster counts
would still reflect the unfiltered data and a single-species view would show
inflated numbers. Rebuilding keeps the counts honest.

## Visual design

Dark editorial palette shared with the author's other mapping work: `#0b0c10`
ground, warm off-white text, orange `#fb923c` as the single accent, and cool blue
`#9fd0e6` for fossils and links. Newsreader carries the editorial voice, Inter the
interface labels. Tokens live at the top of `src/index.css`.

Species are listed by common name, with the scientific name beneath, because a
latin binomial tells a general reader nothing.

Selecting a species opens a summary panel: total sightings, the year span, and
the six countries with the most records, each with its flag. `build.py` tallies
those per species, so they come from the dataset rather than a lookup table. The
panel also carries the precision legend, since paw colour is otherwise
unexplained: pale means located to within 1 km, orange means vaguer.

## Project structure

```
src/
  components/
    map/MapView.tsx              Mapbox setup, layers, interaction
    species/SpeciesRail.tsx      species filter and dataset summary
    occurrence/OccurrenceCard.tsx detail panel, live GBIF fetch
  lib/
    data.ts                      dataset loading, packed → GeoJSON
    gbif.ts                      live occurrence fetch, media licensing
  types/index.ts                 application data model
  App.tsx                        state and layout
scripts/
  gbif/fetch.py                  GBIF acquisition
  processing/build.py            quality rules, packing, species metadata
data/                            raw + processed (gitignored)
public/data/                     what the app serves (gitignored)
```

## Build and deploy

```bash
bun run build
```

Outputs a fully static `dist/`. Any static host works. Build command
`bun run build`, output directory `dist`, one environment variable
`VITE_MAPBOX_TOKEN`.

### GitHub Pages

`.github/workflows/deploy.yml` builds and publishes on every push to `main`.
Two one-time settings are needed:

1. **Settings > Secrets and variables > Actions**, add a repository secret
   `VITE_MAPBOX_TOKEN`.
2. **Settings > Pages**, set Source to **GitHub Actions**.

The site then serves at `https://<user>.github.io/felis/`.

A project site lives under `/<repo>/`, so asset and data URLs need that prefix.
`vite.config.ts` reads `VITE_BASE` (the workflow sets it from the repo name) and
`src/lib/data.ts` builds data URLs from `import.meta.env.BASE_URL`. Without both,
the page loads blank and the JSON 404s. For a user site, in a repo named
`<user>.github.io`, set `VITE_BASE` to `/` instead.

`public/data/` is committed, so a clone builds and deploys without running the
hour-long fetch. Refresh it when you want newer data:

```bash
bun run data:all
```

### What the deployed site requests

| Action | Network |
| --- | --- |
| First load | `occurrences.json`, 11 MB raw and about 2.8 MB gzipped by the host |
| Pan, zoom, filter by species | nothing, it is all client side |
| Click one sighting | one call to `api.gbif.org` for that record |

There is no per-view API traffic and no database. A hosted database would ship
the same bytes through an extra dependency, so it is only worth adding if the
product later needs accounts or server-side spatial queries.

### Before making the repository public

`.env` is gitignored, so the token is not in git. But `VITE_*` variables are
compiled into the browser bundle, which is unavoidable for Mapbox GL: the token
has to reach the client. **Restrict the token to your deployed domains** under
URL restrictions at
[account.mapbox.com/access-tokens](https://account.mapbox.com/access-tokens/),
otherwise anyone can copy it from the bundle and spend your quota. Use a separate
token for production and keep the unrestricted one for localhost.

## Data attribution

Occurrence data is provided by [GBIF](https://www.gbif.org) and its publishing
institutions. Individual records link back to their GBIF page, which carries the
full citation and the publisher's terms.

Media is shown only when the record's licence permits it: Creative Commons `BY`
variants and public-domain dedications. Anything else is omitted rather than
displayed without clear rights. Each image is captioned with its creator or rights
holder and its licence.

The dataset date shown in the interface is the actual date `fetch.py` last ran.
