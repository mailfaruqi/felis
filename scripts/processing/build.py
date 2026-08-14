"""
Turn the raw GBIF pull into the two files the app loads.

  data/raw/occurrences.jsonl.gz -> public/data/occurrences.json  packed coords
                                   public/data/species.json      species + counts
                                   data/processed/report.json    exclusions

Plain JSON rather than a pre-gzipped file: hosts gzip it on the wire anyway
(~11 MB down to ~3.8 MB) with no decompression code in the app. Packed arrays
rather than GeoJSON: 11 MB against 36 MB, since GeoJSON repeats every key.

Usage:  python3 scripts/processing/build.py
"""

import gzip
import json
import time
from collections import Counter
from pathlib import Path
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "data" / "raw" / "occurrences.jsonl.gz"
FETCH_META = ROOT / "data" / "raw" / "fetch-meta.json"
PUBLIC = ROOT / "public" / "data"
PROCESSED = ROOT / "data" / "processed"

# Uncertainty tiers in metres. Median is ~20 m but the 90th percentile is ~27 km.
PRECISE_MAX = 1_000
APPROX_MAX = 10_000
PRECISION_PRECISE, PRECISION_APPROX, PRECISION_COARSE = 0, 1, 2

# a real key, but not a real determination
UNIDENTIFIED_KEY = 9668525


def title_case(name):
    """Capitalise each word; str.title() would give "Pallas'S Cat"."""
    return " ".join(w[:1].upper() + w[1:] for w in name.split(" "))


def species_meta(key):
    """Fetch scientific + English vernacular name for one species key."""
    def api(path):
        req = Request(f"https://api.gbif.org/v1/species/{path}",
                      headers={"User-Agent": "felis-atlas/1.0"})
        with urlopen(req, timeout=30) as r:
            return json.load(r)

    info = api(str(key))
    vernacular = None
    try:
        names = api(f"{key}/vernacularNames?limit=200").get("results", [])
        english = [
            " ".join(n["vernacularName"].split())
            for n in names
            if n.get("language") == "eng" and n.get("vernacularName")
        ]
        if english:
            # most-agreed name; the shortest would give "Chaus" over "Jungle Cat"
            counts = Counter(n.lower() for n in english)
            vernacular = title_case(counts.most_common(1)[0][0])
    except Exception:
        pass

    # basisOfRecord is not a reliable palaeontology filter: only 79 of 136
    # Felis atrox records are tagged FOSSIL_SPECIMEN, and Felis studeri none.
    extinct = None
    try:
        profiles = api(f"{key}/speciesProfiles?limit=20").get("results", [])
        flags = {p["extinct"] for p in profiles if p.get("extinct") is not None}
        if flags:
            extinct = True in flags
    except Exception:
        pass

    return {
        "key": key,
        "scientificName": info.get("canonicalName") or info.get("scientificName"),
        "authorship": info.get("authorship") or "",
        "vernacularName": vernacular,
        "rank": info.get("rank"),
        "extinctPerGbif": extinct,
        "taxonomicStatus": info.get("taxonomicStatus"),
    }


def main():
    if not RAW.exists():
        raise SystemExit(f"Missing {RAW}. Run: python3 scripts/gbif/fetch.py")

    PUBLIC.mkdir(parents=True, exist_ok=True)
    PROCESSED.mkdir(parents=True, exist_ok=True)

    excluded = Counter()
    kept = []
    by_species = Counter()
    species_images = Counter()
    species_fossils = Counter()
    countries = set()
    country_names = {}
    species_countries = {}
    species_years = {}
    fossil_count = 0
    years = []
    seen_keys = set()

    truncated = False
    with gzip.open(RAW, "rt", encoding="utf-8") as fh:
        # tolerate a partially written file from an interrupted fetch
        while True:
            try:
                line = fh.readline()
            except (EOFError, gzip.BadGzipFile, OSError):
                truncated = True
                break
            if not line:
                break
            try:
                r = json.loads(line)
            except json.JSONDecodeError:
                truncated = True
                break
            lat, lon = r.get("decimalLatitude"), r.get("decimalLongitude")

            if lat is None or lon is None:
                excluded["missing_coordinates"] += 1
                continue
            if not (-90 <= lat <= 90) or not (-180 <= lon <= 180):
                excluded["coordinates_out_of_bounds"] += 1
                continue
            if lat == 0 and lon == 0:
                excluded["null_island"] += 1
                continue
            if r["key"] in seen_keys:
                excluded["duplicate_key"] += 1
                continue
            if r.get("speciesKey") is None:
                excluded["no_species_key"] += 1
                continue

            seen_keys.add(r["key"])

            unc = r.get("coordinateUncertaintyInMeters")
            if unc is None or unc > APPROX_MAX:
                precision = PRECISION_COARSE
            elif unc <= PRECISE_MAX:
                precision = PRECISION_PRECISE
            else:
                precision = PRECISION_APPROX

            is_fossil = 1 if r.get("basisOfRecord") == "FOSSIL_SPECIMEN" else 0
            fossil_count += is_fossil

            skey = r["speciesKey"]
            by_species[skey] += 1
            if is_fossil:
                species_fossils[skey] += 1
            if r.get("hasImage"):
                species_images[skey] += 1
            code = r.get("countryCode")
            if code:
                countries.add(code)
                country_names.setdefault(code, r.get("country") or code)
                species_countries.setdefault(skey, Counter())[code] += 1
            year = r.get("year") or 0
            if year:
                years.append(year)
                span = species_years.setdefault(skey, [year, year])
                span[0], span[1] = min(span[0], year), max(span[1], year)

            kept.append([
                round(lon, 5),
                round(lat, 5),
                skey,           # replaced with a compact index below
                year,
                r["key"],
                precision,
                is_fossil,
            ])

    ordered = [k for k, _ in by_species.most_common()]
    index_of = {k: i for i, k in enumerate(ordered)}
    print(f"Fetching metadata for {len(ordered)} species...")
    species = []
    for key in ordered:
        meta = species_meta(key)
        meta["count"] = by_species[key]
        meta["imageCount"] = species_images[key]
        meta["fossilCount"] = species_fossils[key]
        meta["unidentified"] = key == UNIDENTIFIED_KEY
        meta["topCountries"] = [
            {"code": c, "name": country_names.get(c, c), "count": n}
            for c, n in species_countries.get(key, Counter()).most_common(6)
        ]
        span = species_years.get(key)
        meta["yearMin"], meta["yearMax"] = (span[0], span[1]) if span else (None, None)

        # no profile: fall back to the record mix
        if meta["extinctPerGbif"] is None:
            meta["extinct"] = species_fossils[key] / by_species[key] > 0.5
            meta["extinctSource"] = "inferred from basisOfRecord"
        else:
            meta["extinct"] = meta["extinctPerGbif"]
            meta["extinctSource"] = "GBIF species profile"

        species.append(meta)
        flag = "  EXTINCT" if meta["extinct"] else ""
        print(f"  {meta['scientificName']:<28} {by_species[key]:>7,}"
              f"{'  (' + str(species_fossils[key]) + ' fossil)' if species_fossils[key] else ''}{flag}")

    # two Felis chaus keys exist; mark them so the UI can show authorship
    name_counts = Counter(s["scientificName"] for s in species)
    for s in species:
        s["ambiguousName"] = name_counts[s["scientificName"]] > 1

    # Compact indices, and every record of an extinct taxon counts as palaeo.
    extinct_indices = {i for i, s in enumerate(species) if s["extinct"]}
    for row in kept:
        row[2] = index_of[row[2]]
        if row[2] in extinct_indices:
            row[6] = 1

    overall_countries = Counter()
    for tally in species_countries.values():
        overall_countries.update(tally)

    palaeo_total = sum(1 for row in kept if row[6] == 1)
    for s in species:
        s["fossilCount"] = s["count"] if s["extinct"] else s["fossilCount"]

    if truncated:
        print("\nWARNING: raw file ended mid-stream; processing what was readable.\n"
              "Re-run scripts/gbif/fetch.py for a complete dataset.")

    fetch_meta = json.loads(FETCH_META.read_text()) if FETCH_META.exists() else {}
    dataset = {
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "fetchedAt": fetch_meta.get("fetchedAt"),
        "source": "GBIF Occurrence Store",
        "genusTaxonKey": 2435022,
        "count": len(kept),
        "countryCount": len(countries),
        "fossilCount": palaeo_total,
        "fossilSpecimenCount": fossil_count,
        "extinctSpeciesCount": len(extinct_indices),
        "yearMin": min(years) if years else None,
        "yearMax": max(years) if years else None,
        # [lon, lat, speciesIndex, year(0=unknown), gbifKey, precision, isFossil]
        "topCountries": [
            {"code": c, "name": country_names.get(c, c), "count": n}
            for c, n in overall_countries.most_common(6)
        ],
        "fields": ["lon", "lat", "s", "year", "key", "precision", "fossil"],
        "precisionTiers": {
            "0": f"<= {PRECISE_MAX} m",
            "1": f"{PRECISE_MAX}-{APPROX_MAX} m",
            "2": f"> {APPROX_MAX} m or unrecorded",
        },
        "species": species,
    }

    (PUBLIC / "species.json").write_text(json.dumps(dataset, indent=2))

    (PUBLIC / "occurrences.json").write_text(
        json.dumps({"count": len(kept), "points": kept}, separators=(",", ":"))
    )

    report = {
        "generatedAt": dataset["generatedAt"],
        "rawRecordsRead": sum(excluded.values()) + len(kept),
        "recordsKept": len(kept),
        "recordsExcluded": sum(excluded.values()),
        "exclusionsByRule": dict(excluded),
        "rulesApplied": [
            "GBIF query filter: hasCoordinate=true, hasGeospatialIssue=false",
            "drop records with missing latitude or longitude",
            "drop coordinates outside [-90,90] / [-180,180]",
            "drop exact (0,0) 'null island' coordinates",
            "drop duplicate GBIF occurrence keys",
            "drop records with no speciesKey (genus-level identification only)",
            "retain fossils and extinct taxa, flagged and hidden by default",
            "flag extinction from GBIF speciesProfiles; fall back to fossil-majority",
            "treat every record of an extinct taxon as palaeontological",
            "retain low-precision records, tiered by coordinate uncertainty",
        ],
        "speciesCount": len(species),
        "countryCount": len(countries),
        "fossilSpecimenCount": fossil_count,
        "palaeoRecordCount": palaeo_total,
        "extinctSpecies": [s['scientificName'] for s in species if s['extinct']],
    }
    (PROCESSED / "report.json").write_text(json.dumps(report, indent=2))

    pts_mb = (PUBLIC / "occurrences.json").stat().st_size / 1e6
    print(f"\nKept {len(kept):,} records across {len(species)} species, "
          f"{len(countries)} countries")
    print(f"Excluded {sum(excluded.values()):,}: {dict(excluded) or 'none'}")
    print(f"Fossil specimens: {fossil_count:,} | palaeo records hidden by default: {palaeo_total:,}")
    print(f"Extinct taxa: {len(extinct_indices)}")
    print(f"public/data/occurrences.json  {pts_mb:.1f} MB "
          f"(~{pts_mb * 0.33:.1f} MB gzipped on the wire)")
    print(f"public/data/species.json      "
          f"{(PUBLIC / 'species.json').stat().st_size / 1e3:.1f} KB")


if __name__ == "__main__":
    main()
