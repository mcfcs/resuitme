"""Harvest real internship job descriptions from the local Sorpple archive.

WHY: the eval fixtures are 10 hand-written JDs. Real postings are messier —
inconsistent headings, boilerplate, vague requirements — and the analyzer has
never been measured against them.

READ-ONLY BY CONSTRUCTION. Sorpple's own sorpple_archive.description() caches
full text back into listings.json; we deliberately do NOT use it. Instead we
read the archive (or a copy of it) and call the per-source fetchers directly,
so the source repo is never mutated.

Sources are JobStreet and Prosple only. Indeed is excluded: it is the one board
that needs paid rotating proxies for Cloudflare, and its listings add nothing
the other two do not already provide.

Usage:
    python evals/harvest-jds.py --archive <path> --out <path> [--limit 100]
"""

from __future__ import annotations

import argparse
import json
import random
import sys
import time
from pathlib import Path

SORPPLE = Path(r"C:\Users\Spectre\Documents\GitHub\sorpple")

# Stratified so the corpus can answer the question that matters: does the
# analyzer notice when a CS profile is applying somewhere it does not belong?
#   match      -> should score well (true positive)
#   generic    -> neutral baseline, often domain-agnostic
#   mismatch   -> a CS student has no business here; the analyzer must say so
#   adjacent   -> the hard middle, where over-flagging would be a false alarm
STRATA: dict[str, list[str]] = {
    "match": ["Information & Communication Technology"],
    "generic": ["Internship, Clerkship or Placement"],
    "mismatch": [
        "Human Resources & Recruitment",
        "Marketing & Communications",
        "Accounting",
        "Administration & Office Support",
    ],
    "adjacent": [
        "Engineering",
        "Design & Architecture",
        "Banking & Financial Services",
    ],
}

# Roughly even coverage, weighted slightly toward the two strata that carry the
# signal we most want to measure.
QUOTAS = {"match": 25, "generic": 25, "mismatch": 35, "adjacent": 15}

# Politeness. Sorpple itself polls these boards every 10 minutes from this same
# IP with a 1s gap between listings; 1.5s over ~100 requests is well inside
# ordinary browsing behaviour.
DELAY_SECONDS = 1.5

# Below this, the "description" is a teaser or an error page, not a real JD.
MIN_DESCRIPTION_CHARS = 200


def load_fetchers():
    """Import Sorpple's stdlib-only monitors without triggering their CLI.

    The monitors' __main__ paths call load_config(), which sys.exit(1)s without
    Discord credentials — importing the module is safe, running it is not.
    """
    sys.path.insert(0, str(SORPPLE))
    import jobstreet_monitor  # type: ignore[import-not-found]
    import prosple_monitor  # type: ignore[import-not-found]

    return {
        "jobstreet": (
            jobstreet_monitor.fetch_description,
            jobstreet_monitor.html_to_markdown,
        ),
        "prosple": (
            prosple_monitor.fetch_description,
            prosple_monitor.html_to_markdown,
        ),
    }


def stratum_of(classification: str | None) -> str | None:
    for name, members in STRATA.items():
        if (classification or "") in members:
            return name
    return None


def pick(listings: list[dict], seed: int) -> list[dict]:
    """Stratified sample. Seeded so a re-run reproduces the same corpus."""
    rng = random.Random(seed)
    buckets: dict[str, list[dict]] = {k: [] for k in STRATA}
    for item in listings:
        if item.get("source") not in ("jobstreet", "prosple"):
            continue
        s = stratum_of(item.get("classification"))
        if s:
            buckets[s].append(item)

    chosen: list[dict] = []
    for name, quota in QUOTAS.items():
        pool = buckets[name]
        rng.shuffle(pool)
        take = pool[:quota]
        if len(take) < quota:
            print(
                f"  note: stratum {name!r} has only {len(pool)} records "
                f"(wanted {quota})",
                file=sys.stderr,
            )
        for item in take:
            chosen.append({**item, "stratum": name})
    return chosen


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--archive", required=True, help="Path to listings.json")
    ap.add_argument("--out", required=True, help="Where to write the corpus")
    ap.add_argument("--limit", type=int, default=100)
    ap.add_argument("--seed", type=int, default=20260910)
    args = ap.parse_args()

    fetchers = load_fetchers()
    listings = json.loads(Path(args.archive).read_text(encoding="utf-8"))["listings"]
    targets = pick(listings, args.seed)[: args.limit]
    print(f"Selected {len(targets)} listings across {len(STRATA)} strata.", file=sys.stderr)

    out: list[dict] = []
    skipped = 0
    for i, item in enumerate(targets, 1):
        source = item["source"]
        fetch, to_markdown = fetchers[source]
        label = f"[{i}/{len(targets)}] {item['stratum']:9s} {source:9s} {item['id']}"
        try:
            raw = fetch(item["id"])
            text = to_markdown(raw).strip() if raw else ""
        except Exception as exc:  # noqa: BLE001 - one bad listing must not abort
            print(f"{label} FAILED: {exc}", file=sys.stderr)
            skipped += 1
            time.sleep(DELAY_SECONDS)
            continue

        if len(text) < MIN_DESCRIPTION_CHARS:
            print(f"{label} too short ({len(text)} chars), skipped", file=sys.stderr)
            skipped += 1
            time.sleep(DELAY_SECONDS)
            continue

        out.append(
            {
                "id": item["id"],
                "source": source,
                "stratum": item["stratum"],
                "title": item.get("title"),
                "company": item.get("company"),
                "classification": item.get("classification"),
                "url": item.get("url"),
                "description": text,
            }
        )
        print(f"{label} ok ({len(text)} chars)", file=sys.stderr)
        time.sleep(DELAY_SECONDS)

    Path(args.out).write_text(
        json.dumps({"harvested": out}, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    print(f"\nWrote {len(out)} JDs to {args.out} ({skipped} skipped).", file=sys.stderr)
    return 0 if out else 1


if __name__ == "__main__":
    raise SystemExit(main())
