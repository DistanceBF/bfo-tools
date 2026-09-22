"""Check and apply BFO Tools updates published as GitHub Releases."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import urllib.error
import urllib.request
import zipfile

OWNER = "DistanceBF"
REPOSITORY = "bfo-tools"
PROJECT = Path(__file__).resolve().parent
PROTECTED = {"web2/gme.sqlite", "web2/.active-gme-path.txt", "data/gme.sqlite"}
PROTECTED_PREFIXES = ("missions/", ".backups/", "backup/")


def version():
    return (PROJECT / "VERSION").read_text(encoding="utf-8").strip()


def token():
    value = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN")
    if value:
        return value
    gh_candidates = ["gh", r"C:\Program Files\GitHub CLI\gh.exe"]
    for executable in gh_candidates:
        try:
            return subprocess.check_output([executable, "auth", "token"], text=True, stderr=subprocess.DEVNULL).strip()
        except (OSError, subprocess.CalledProcessError):
            continue
    return ""


def latest_release():
    url = f"https://api.github.com/repos/{OWNER}/{REPOSITORY}/releases/latest"
    request = urllib.request.Request(url, headers={"Accept": "application/vnd.github+json"})
    auth = token()
    if auth:
        request.add_header("Authorization", f"Bearer {auth}")
    with urllib.request.urlopen(request, timeout=15) as response:
        return json.load(response)


def check():
    current = version()
    try:
        release = latest_release()
    except urllib.error.HTTPError as error:
        if error.code == 404:
            return {"ok": True, "current": current, "available": False, "message": "No GitHub release has been published yet."}
        raise
    latest = release.get("tag_name", "").lstrip("v")
    return {
        "ok": True,
        "current": current,
        "latest": latest,
        "available": bool(latest and latest != current),
        "name": release.get("name") or release.get("tag_name"),
        "notes": release.get("body") or "",
        "url": release.get("html_url", ""),
    }


def safe_path(relative):
    relative = relative.replace("\\", "/").lstrip("/")
    if relative in PROTECTED or any(relative.startswith(prefix) for prefix in PROTECTED_PREFIXES):
        return None
    destination = (PROJECT / relative).resolve()
    if PROJECT not in destination.parents:
        return None
    return destination


def apply():
    release = latest_release()
    tag = release.get("tag_name", "").lstrip("v")
    if not tag or tag == version():
        return {"ok": True, "updated": False, "current": version(), "message": "Already up to date."}
    archive_url = f"https://api.github.com/repos/{OWNER}/{REPOSITORY}/zipball/{release['tag_name']}"
    request = urllib.request.Request(archive_url, headers={"Accept": "application/vnd.github+json"})
    auth = token()
    if auth:
        request.add_header("Authorization", f"Bearer {auth}")
    with tempfile.TemporaryDirectory(prefix="bfo-update-") as folder:
        archive = Path(folder) / "update.zip"
        with urllib.request.urlopen(request, timeout=60) as response, archive.open("wb") as output:
            shutil.copyfileobj(response, output)
        extract = Path(folder) / "files"
        with zipfile.ZipFile(archive) as package:
            package.extractall(extract)
        roots = list(extract.iterdir())
        source = roots[0] if len(roots) == 1 and roots[0].is_dir() else extract
        for item in source.rglob("*"):
            if not item.is_file():
                continue
            relative = item.relative_to(source).as_posix()
            destination = safe_path(relative)
            if destination is None:
                continue
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(item, destination)
    return {"ok": True, "updated": True, "current": tag, "message": f"Updated to {tag}. Restart the server."}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("check", "apply"))
    args = parser.parse_args()
    print(json.dumps(check() if args.command == "check" else apply()))
