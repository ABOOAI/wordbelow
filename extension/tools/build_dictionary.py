#!/usr/bin/env python3
"""Build local single-token Chinese lookup shards from the official ECDICT CSV.

This reads data only: it never imports or executes ECDICT project code.
Python standard library only. Run with --help for reproducible build arguments.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import string
from pathlib import Path

TOKEN = re.compile(r"[a-z]+(?:['-][a-z]+)*\Z")
CHINESE = re.compile(r"[\u3400-\u9fff]")
POS = re.compile(r"^(?:(?:n|v|vt|vi|adj|adv|a|prep|pron|conj|art|aux|num|int|det|abbr|pl|sing|verb|adjective|adverb)\.?\s+)+", re.I)
INFLECTION = re.compile(r"(?:的(?:过去式|过去分词|现在分词|第三人称单数|复数)|过去式和过去分词)")


def normalize(word: str) -> str:
    return word.strip().replace("’", "'").replace("‘", "'").lower()


def chinese_meanings(text: str) -> list[str]:
    """Keep the first two real Chinese senses, stripping POS/domain prefixes."""
    meanings: list[str] = []
    for section in text.replace("\\n", "\n").splitlines():
        section = POS.sub("", section.strip())
        section = re.sub(r"^(?:\[[^\]]+\]\s*)+", "", section).strip()
        for fragment in re.split(r"[;；,，、]", section):
            fragment = POS.sub("", fragment.strip())
            fragment = re.sub(r"^(?:\[[^\]]+\]\s*)+", "", fragment).strip()
            if not CHINESE.search(fragment) or fragment in meanings:
                continue
            meanings.append(fragment)
            if len(meanings) == 2:
                return meanings
    return meanings


def make_value(meanings: list[str]) -> str | list[str]:
    full = "；".join(meanings)
    display = re.sub(r"\s*[（(][^()（）]*(?:的过去式|的过去分词|的现在分词|的第三人称|的复数)[^()（）]*[)）]", "", full).strip()
    if CHINESE.search(display) and len(display) <= 18:
        return display if display == full else [display, full[:240]]
    # Avoid packing an explanatory second sense into a tiny interlinear label.
    first = meanings[0]
    if len(first) <= 18:
        return [first, full[:240]]
    # Some acronym rows start with a lengthy English expansion followed by its
    # Chinese meaning. Clipping that prefix would create an English-only label.
    label = first
    if not CHINESE.search(label[:17]):
        label = label[CHINESE.search(label).start():].lstrip()
    if len(label) <= 18:
        return [label, full[:240]]
    return [label[:17].rstrip(" ()（）;；,，") + "…", full[:240]]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--source-commit", required=True)
    parser.add_argument("--source-commit-date", required=True)
    parser.add_argument("--build-date", required=True)
    args = parser.parse_args()
    raw_digest = hashlib.file_digest(args.input.open("rb"), "sha256").hexdigest()
    entries: dict[str, str | list[str]] = {}
    priorities: dict[str, int] = {}
    inflected: set[str] = set()
    abbreviation_inflections: set[str] = set()
    aliases: dict[str, str] = {}
    csv_rows = 0
    eligible_rows = 0
    with args.input.open("r", encoding="utf-8-sig", newline="") as source:
        for row in csv.DictReader(source):
            csv_rows += 1
            word = normalize(row["word"])
            if not TOKEN.fullmatch(word):
                continue
            meanings = chinese_meanings(row.get("translation", ""))
            if not meanings:
                continue
            eligible_rows += 1
            priority = 2 if row["word"] == word else 1
            if priority >= priorities.get(word, 0):
                entries[word] = make_value(meanings)
                priorities[word] = priority
                if INFLECTION.search(meanings[0]):
                    inflected.add(word)
            for item in row.get("exchange", "").split("/"):
                if ":" not in item:
                    continue
                kind, values = item.split(":", 1)
                for value in values.split(","):
                    variant = normalize(value)
                    if not TOKEN.fullmatch(variant) or variant == word:
                        continue
                    if kind == "0":
                        aliases[word] = variant
                        if row.get("translation", "").lstrip().lower().startswith("abbr"):
                            abbreviation_inflections.add(word)
                    elif kind in {"p", "d", "i", "3", "s", "r", "t"}:
                        aliases.setdefault(variant, word)
    direct_count = len(entries)
    alias_added = 0
    alias_improved = 0
    for variant, base in aliases.items():
        # Follow only attested ECDICT exchange relationships, never guess a stem.
        if base not in entries:
            continue
        if variant not in entries:
            entries[variant] = entries[base]
            alias_added += 1
        elif (variant in inflected or variant in abbreviation_inflections or priorities.get(variant, 0) < 2) and base not in inflected and priorities.get(base, 0) == 2:
            entries[variant] = entries[base]
            alias_improved += 1
    args.output.mkdir(parents=True, exist_ok=True)
    shards = {letter: {} for letter in string.ascii_lowercase}
    shards["other"] = {}
    for word in sorted(entries):
        shard_name = word[0] if word[0] in string.ascii_lowercase else "other"
        shards[shard_name][word] = entries[word]
    shard_metadata = {}
    for name, shard in shards.items():
        payload = json.dumps(shard, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        (args.output / f"{name}.json").write_bytes(payload)
        shard_metadata[name] = {
            "entries": len(shard),
            "bytes": len(payload),
            "sha256": hashlib.sha256(payload).hexdigest(),
        }
    metadata = {
        "formatVersion": 1,
        "source": "ECDICT",
        "repository": "https://github.com/skywind3000/ECDICT",
        "sourceCommit": args.source_commit,
        "sourceCommitDate": args.source_commit_date,
        "csvUrl": f"https://raw.githubusercontent.com/skywind3000/ECDICT/{args.source_commit}/ecdict.csv",
        "csvBytes": args.input.stat().st_size,
        "csvSha256": raw_digest,
        "csvRows": csv_rows,
        "eligibleSingleTokenRows": eligible_rows,
        "directEntries": direct_count,
        "exchangeAliasesAdded": alias_added,
        "inflectionEntriesImproved": alias_improved,
        "totalEntries": len(entries),
        "buildDate": args.build_date,
        "license": "MIT; see ECDICT-LICENSE.txt",
        "selection": "ASCII English single tokens, internal apostrophes/hyphens allowed; Chinese senses only. Case is normalized. Multi-word expressions are excluded.",
        "glossPolicy": "First one or two Chinese senses. POS/domain labels and redundant parenthesized inflection suffixes removed from the short label. Attested inflections prefer a lowercase base over an uppercase-only acronym collision. Labels over 18 characters use the first sense or ellipsis. Long English acronym expansions are skipped to keep Chinese in the short label. Original senses remain in optional full field.",
        "shards": shard_metadata,
    }
    (args.output / "metadata.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({key: metadata[key] for key in ("csvRows", "directEntries", "exchangeAliasesAdded", "inflectionEntriesImproved", "totalEntries", "csvSha256")}, ensure_ascii=False))
    print(f"Dictionary shards: {sum(item['bytes'] for item in shard_metadata.values()):,} bytes")


if __name__ == "__main__":
    main()
