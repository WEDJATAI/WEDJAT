#!/usr/bin/env python3
"""Fetch a URL and save cleaned text to db/trade-corpus/raw/<name>.txt.
Usage: python3 scripts/fetch-page.py <url> <name> [--curl] [--max N]
Tries plain curl first (fast), falls back to z-ai page_reader if empty/blocked.
Prints the first --max chars (default 6000) for grounding."""
import json
import os
import re
import subprocess
import sys
import html as h

RAW = "scripts/trade-corpus/raw"
os.makedirs(RAW, exist_ok=True)

url, name = sys.argv[1], sys.argv[2]
force_curl_only = "--curl" in sys.argv
force_reader = "--reader" in sys.argv
maxn = 6000
if "--max" in sys.argv:
    maxn = int(sys.argv[sys.argv.index("--max") + 1])

def clean(raw: str) -> str:
    t = re.sub(r"<(script|style|noscript)[\s\S]*?</\1>", " ", raw, flags=re.I)
    # tables → pipe rows for readability
    t = re.sub(r"<(td|th)[^>]*>", " | ", t)
    t = re.sub(r"</tr>", " |\n", t)
    t = re.sub(r"<br\s*/?>", "\n", t)
    t = re.sub(r"</(p|div|li|h[1-6]|tr|table|ul|ol)>", "\n", t)
    t = re.sub(r"<li[^>]*>", "\n- ", t)
    t = re.sub(r"<h([1-6])[^>]*>", lambda m: "\n" + "#" * int(m.group(1)) + " ", t)
    t = re.sub(r"<[^>]+>", " ", t)
    t = h.unescape(t)
    t = re.sub(r"[ \t]+", " ", t)
    t = re.sub(r"\n[ ]+", "\n", t)
    t = re.sub(r"\n{3,}", "\n\n", t)
    return t.strip()

out_path = os.path.join(RAW, name + ".txt")
text = ""
title = ""
method = ""

def try_curl(u: str) -> tuple[str, str]:
    try:
        r = subprocess.run(
            ["curl", "-sL", "--max-time", "30", "-A",
             "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
             u], capture_output=True, text=True, timeout=40)
        return r.stdout, ""
    except Exception:
        return "", ""

def try_reader(u: str) -> tuple[str, str]:
    try:
        subprocess.run(["z-ai", "function", "-n", "page_reader", "-a",
                        json.dumps({"url": u}), "-o", "/tmp/_fp.json"],
                       capture_output=True, text=True, timeout=90)
        d = json.load(open("/tmp/_fp.json"))
        data = d.get("data", d)
        return data.get("html") or data.get("text") or "", data.get("title") or ""
    except Exception:
        return "", ""

# Wikipedia API special-case: use explaintext for perfect clean text
if "wikipedia.org/w/api.php" in url:
    raw, _ = try_curl(url)
    if raw:
        try:
            d = json.loads(raw)
            pages = d.get("query", {}).get("pages", {})
            for _, p in pages.items():
                text = p.get("extract", "")
                title = p.get("title", "")
                method = "wiki-api"
        except Exception:
            text = ""

if not text and not force_curl_only and not force_reader:
    raw, _ = try_curl(url)
    if len(raw) > 500 and ("<html" in raw[:2000].lower() or "<?xml" in raw[:200].lower()):
        text = clean(raw)
        title = (re.search(r"<title[^>]*>(.*?)</title>", raw, re.S | re.I) or [None, ""])[1]
        method = "curl"

if force_reader or not text or len(text) < 300:
    raw, t2 = try_reader(url)
    if raw:
        text = clean(raw) if "<" in raw[:100] else raw
        title = t2 or title
        method = (method + "+reader") if method else "reader"

if not text:
    print(f"FETCH-FAILED\t{url}")
    sys.exit(1)

with open(out_path, "w") as f:
    f.write(f"SOURCE-URL: {url}\nSOURCE-TITLE: {title}\nFETCH-METHOD: {method}\n====\n{text}\n")
print(f"OK\t{method}\t{len(text)} chars\t{title[:80]}")
print(text[:maxn])
