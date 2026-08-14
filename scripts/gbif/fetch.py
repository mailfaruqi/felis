"""
Fetch every Felis occurrence with coordinates from GBIF into
data/raw/occurrences.jsonl.gz.

GBIF rejects offsets above 100,001, so the genus cannot be paged in one query.
Slicing by country works because hasCoordinate=true makes GBIF backfill country
from the coordinates, and the largest slice stays under the ceiling. Facet counts
give every slice's size up front, so all pages are fetched concurrently.

Usage:  python3 scripts/gbif/fetch.py [--limit-countries N] [--workers N]
"""

import argparse
import gzip
import json
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError

API = "https://api.gbif.org/v1/occurrence/search"
GENUS_FELIS_KEY = 2435022  # backbone key, not the ChecklistBank id 4JQ8
PAGE_SIZE = 300  # GBIF maximum
MAX_OFFSET = 100_001  # GBIF hard ceiling

BASE_FILTER = {
    "taxonKey": GENUS_FELIS_KEY,
    "hasCoordinate": "true",
    "hasGeospatialIssue": "false",
}

KEEP = [
    "key",
    "speciesKey",
    "species",
    "scientificName",
    "acceptedTaxonKey",
    "decimalLatitude",
    "decimalLongitude",
    "coordinateUncertaintyInMeters",
    "countryCode",
    "country",
    "year",
    "eventDate",
    "basisOfRecord",
    "datasetKey",
    "datasetName",
    "license",
]

OUT_DIR = Path(__file__).resolve().parents[2] / "data" / "raw"


def get(params, retries=5):
    """GET with backoff; GBIF 503s under load."""
    url = f"{API}?{urlencode(params)}"
    for attempt in range(retries):
        try:
            req = Request(url, headers={"User-Agent": "felis-atlas/1.0 (GBIF occurrence viewer)"})
            with urlopen(req, timeout=90) as r:
                return json.load(r)
        except (URLError, HTTPError, TimeoutError, json.JSONDecodeError):
            if attempt == retries - 1:
                raise
            time.sleep(1.5 * (2**attempt))
    raise RuntimeError("unreachable")


def trim(rec):
    out = {k: rec[k] for k in KEEP if k in rec and rec[k] is not None}
    out["hasImage"] = any(m.get("type") == "StillImage" for m in rec.get("media", []))
    return out


def build_pages(countries):
    """Expand country counts into a flat list of page tasks."""
    pages = []
    for code, count in countries:
        if count <= MAX_OFFSET:
            slices = [({"country": code}, code, count)]
        else:
            print(f"  {code}: {count:,} exceeds offset ceiling, splitting by decade")
            slices = []
            for start in range(1500, 2030, 10):
                yr = f"{start},{start + 9}"
                n = get({**BASE_FILTER, "country": code, "year": yr, "limit": 0})["count"]
                if n:
                    slices.append(({"country": code, "year": yr}, f"{code}/{start}s", n))

        for extra, label, n in slices:
            for offset in range(0, n, PAGE_SIZE):
                pages.append(({**extra, "offset": offset}, label))
    return pages


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit-countries", type=int, default=None,
                    help="only fetch the N largest countries (for quick test runs)")
    ap.add_argument("--workers", type=int, default=8, help="concurrent requests")
    args = ap.parse_args()

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    total = get({**BASE_FILTER, "limit": 0})["count"]
    print(f"Genus Felis, coordinates present, no geospatial issue: {total:,} records")

    facet = get({**BASE_FILTER, "limit": 0, "facet": "country", "facetLimit": 400})
    countries = [(c["name"], c["count"]) for c in facet["facets"][0]["counts"]]
    covered = sum(c for _, c in countries)
    print(f"{len(countries)} country slices covering {covered:,} records "
          f"({100 * covered / total:.2f}% of total)")
    if args.limit_countries:
        countries = countries[: args.limit_countries]
        print(f"--limit-countries: restricting to {len(countries)} slices")

    pages = build_pages(countries)
    print(f"Fetching {len(pages):,} pages with {args.workers} workers\n")

    seen = set()
    written = 0
    done = 0
    lock = threading.Lock()
    out_path = OUT_DIR / "occurrences.jsonl.gz"
    started = time.time()

    with gzip.open(out_path, "wt", encoding="utf-8") as fh:
        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            futures = {
                pool.submit(get, {**BASE_FILTER, **p, "limit": PAGE_SIZE}): label
                for p, label in pages
            }
            for fut in as_completed(futures):
                label = futures[fut]
                try:
                    results = fut.result().get("results", [])
                except Exception as e:
                    print(f"  ! {label}: page failed after retries: {e}", file=sys.stderr)
                    results = []

                with lock:
                    for rec in results:
                        # deep paging can repeat a record if GBIF reindexes mid-run
                        if rec["key"] in seen:
                            continue
                        seen.add(rec["key"])
                        fh.write(json.dumps(trim(rec), separators=(",", ":")) + "\n")
                        written += 1
                    done += 1
                    if done % 50 == 0 or done == len(pages):
                        rate = done / max(time.time() - started, 1e-6)
                        eta = (len(pages) - done) / max(rate, 1e-6)
                        print(f"[{done:>4}/{len(pages)}] {written:>7,} records "
                              f"| {rate:4.1f} pages/s | eta {eta / 60:4.1f} min", flush=True)

    elapsed = time.time() - started
    size_mb = out_path.stat().st_size / 1e6
    print(f"\nWrote {written:,} unique records to {out_path} "
          f"({size_mb:.1f} MB gzipped) in {elapsed / 60:.1f} min")

    if not args.limit_countries and written < total * 0.98:
        print(f"WARNING: captured {written:,} of {total:,} expected "
              f"({100 * written / total:.1f}%). Some records may lack a country code.",
              file=sys.stderr)

    meta = {
        "fetchedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "genusTaxonKey": GENUS_FELIS_KEY,
        "filter": BASE_FILTER,
        "gbifReportedTotal": total,
        "recordsFetched": written,
        "countrySlices": len(countries),
    }
    (OUT_DIR / "fetch-meta.json").write_text(json.dumps(meta, indent=2))
    print(f"Wrote {OUT_DIR / 'fetch-meta.json'}")


if __name__ == "__main__":
    main()
