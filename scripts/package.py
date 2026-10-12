"""Build and verify the unpacked Chrome extension release using standard Python.

Run from any directory: python path/to/scripts/package.py
Optional: --output-dir path/to/output
No API calls, credentials, browser profiles, or third-party packages are needed.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import struct
import zipfile
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parent.parent
EXTENSION_ROOT = PROJECT_ROOT / "extension"
PRIVATE_PATTERNS = {
    "private provider workspace address": re.compile(r"https?://llm-[a-z0-9]+\.cn-[a-z0-9-]+\.maas\.aliyuncs\.com", re.I),
    "personal user directory": re.compile(r"[A-Z]:[\\/]Users[\\/][^\\/\s]+", re.I),
    "personal key file": re.compile(r"[A-Z]:[\\/]fanyi[\\/]|[A-Z]:[\\/][^\r\n\"<>]*\.(?:key|pem|p12)\b", re.I),
    "API key literal": re.compile(r"\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b"),
    "GitHub token literal": re.compile(r"\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,})\b"),
    "private key": re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
}
TEXT_SUFFIXES = {".js", ".json", ".html", ".css", ".md", ".txt", ".py", ".svg"}
FORBIDDEN_COMPONENTS = {
    ".git", "node_modules", "__pycache__", "profiles", "browser-profile",
    "chrome-profile", "test-profile", "playwright-profile", "keys", "secrets",
    "private-config", "qwenmt.txt", "api-key.txt", "api-keys.txt",
}


def require(condition: bool, message: str):
    if not condition:
        raise ValueError(message)


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def read_extension() -> tuple[dict, dict[str, bytes], int]:
    manifest = json.loads((EXTENSION_ROOT / "manifest.json").read_text(encoding="utf-8-sig"))
    require(manifest.get("manifest_version") == 3, "Expected Manifest V3.")
    require(manifest.get("permissions") == ["storage", "activeTab", "contextMenus"], "Unexpected extension permissions.")
    require(not manifest.get("host_permissions"), "Required host permissions are not expected.")
    require(manifest.get("optional_host_permissions") == ["http://*/*", "https://*/*"], "Unexpected optional host permissions.")
    require(bool(re.fullmatch(r"\d+\.\d+\.\d+(?:\.\d+)?", manifest.get("version", ""))), "Invalid release version.")

    contents: dict[str, bytes] = {}
    for path in sorted(EXTENSION_ROOT.rglob("*")):
        if not path.is_file():
            continue
        relative = path.relative_to(EXTENSION_ROOT)
        require(not path.is_symlink(), f"Symbolic links cannot be packaged: {relative.as_posix()}")
        require(not any(part.lower() in FORBIDDEN_COMPONENTS for part in relative.parts), f"Private or generated file in extension: {relative.as_posix()}")
        name = path.name.lower()
        require(not name.startswith(".env") and not name.endswith((".key", ".pem", ".p12", ".pfx", ".log", ".bak", ".zip", ".crx")), f"Private or generated file in extension: {relative.as_posix()}")
        require("upgrade-record" not in name and "codex-clipboard" not in name, f"Private work artifact in extension: {relative.as_posix()}")
        data = path.read_bytes()
        contents[relative.as_posix()] = data
        is_shard = relative.parent.as_posix() == "dictionary" and bool(re.fullmatch(r"[a-z]|other", path.stem))
        if path.suffix.lower() in TEXT_SUFFIXES and not is_shard:
            for line_number, line in enumerate(data.decode("utf-8-sig").splitlines(), 1):
                for category, pattern in PRIVATE_PATTERNS.items():
                    # Do not include a matched credential or private value in errors.
                    require(not pattern.search(line), f"Possible {category}: {relative.as_posix()}:{line_number}")

    referenced = [manifest["background"]["service_worker"], manifest["options_page"], manifest["action"]["default_popup"]]
    for script in manifest["content_scripts"]:
        referenced.extend(script["js"] + script["css"])
    referenced.extend(manifest["icons"].values())
    referenced.extend(manifest["action"]["default_icon"].values())
    for resource in referenced:
        require(resource in contents, f"Missing manifest resource: {resource}")
    for group in manifest.get("web_accessible_resources", []):
        for resource in group["resources"]:
            require(any(EXTENSION_ROOT.glob(resource)), f"Missing web-accessible resource: {resource}")
    for icons in [manifest["icons"], manifest["action"]["default_icon"]]:
        for declared_size, resource in icons.items():
            data = contents[resource]
            require(data[:8] == b"\x89PNG\r\n\x1a\n" and len(data) >= 24, f"Invalid PNG icon: {resource}")
            dimensions = struct.unpack(">II", data[16:24])
            require(dimensions == (int(declared_size), int(declared_size)), f"Incorrect icon dimensions: {resource}")

    for resource in ["LICENSE-WordWise.txt", "dictionary/ECDICT-LICENSE.txt", "THIRD-PARTY-NOTICES.md"]:
        require(resource in contents, f"Missing third-party license or attribution: {resource}")
    for resource in ["LICENSE-WordWise.txt", "dictionary/ECDICT-LICENSE.txt"]:
        text = contents[resource].decode("utf-8-sig")
        require(all(fragment in text for fragment in ["Copyright", "Permission is hereby granted", "The above copyright notice", "THE SOFTWARE IS PROVIDED"]), f"Incomplete MIT license: {resource}")

    metadata = json.loads(contents["dictionary/metadata.json"])
    entry_count = 0
    for shard, expected in metadata["shards"].items():
        resource = f"dictionary/{shard}.json"
        require(resource in contents, f"Missing dictionary shard: {resource}")
        data = contents[resource]
        entries = len(json.loads(data))
        entry_count += entries
        require(digest(data) == expected["sha256"] and len(data) == expected["bytes"] and entries == expected["entries"], f"Dictionary integrity mismatch: {resource}")
    require(entry_count == metadata["totalEntries"], "Dictionary total does not match metadata.")
    return manifest, contents, entry_count


def build(output_dir: Path) -> dict:
    output_dir = output_dir.resolve()
    require(output_dir != EXTENSION_ROOT and EXTENSION_ROOT not in output_dir.parents, "Output directory must be outside extension/.")
    manifest, contents, entry_count = read_extension()
    output_dir.mkdir(parents=True, exist_ok=True)
    archive_root = f"WordBelow-{manifest['version']}"
    archive_name = archive_root + ".zip"
    archive_path = output_dir / archive_name
    with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for resource, data in contents.items():
            # Stable metadata makes repeated builds of unchanged source identical.
            info = zipfile.ZipInfo(f"{archive_root}/{resource}", date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, data, compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
    with zipfile.ZipFile(archive_path) as archive:
        expected_names = {f"{archive_root}/{resource}" for resource in contents}
        require(set(archive.namelist()) == expected_names and len(archive.namelist()) == len(contents), "ZIP file list does not match extension source.")
        require(archive.testzip() is None, "ZIP CRC verification failed.")
        for resource, data in contents.items():
            require(archive.read(f"{archive_root}/{resource}") == data, f"ZIP bytes differ from source: {resource}")
    archive_data = archive_path.read_bytes()
    metadata = {
        "name": manifest["name"],
        "version": manifest["version"],
        "archive": archive_name,
        "archiveRoot": archive_root,
        "files": len(contents),
        "unpackedBytes": sum(len(data) for data in contents.values()),
        "zipBytes": len(archive_data),
        "zipSha256": digest(archive_data),
        "dictionaryEntries": entry_count,
        "minimumChromeVersion": manifest["minimum_chrome_version"],
        "permissions": manifest["permissions"],
        "verification": {"sourceBytesMatchArchive": True, "manifestResourcesPresent": True, "dictionaryHashesMatch": True, "privateValueScanPassed": True},
    }
    metadata_name = "release-metadata.json"
    metadata_data = (json.dumps(metadata, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    (output_dir / metadata_name).write_bytes(metadata_data)
    sums = f"{digest(archive_data)}  {archive_name}\n{digest(metadata_data)}  {metadata_name}\n"
    (output_dir / "SHA256SUMS").write_text(sums, encoding="utf-8")
    return metadata


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=PROJECT_ROOT / "dist")
    args = parser.parse_args()
    try:
        result = build(args.output_dir)
    except (OSError, ValueError, KeyError, zipfile.BadZipFile) as error:
        parser.exit(1, f"Package validation failed: {error}\n")
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
