#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Build anymodel-for-claude-code.skill from the plugin skill folder.

Produces a .skill zip whose top-level directory is `anymodel-for-claude-code/`,
containing SKILL.md + scripts/ (matches the standalone Claude Code skill layout).
Excludes runtime data, logs, git, node_modules.
"""
import os
import sys
import zipfile

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(ROOT, "plugins", "anymodel-for-claude-code",
                   "skills", "anymodel-for-claude-code")
OUT = os.path.join(ROOT, "anymodel-for-claude-code.skill")

EXCLUDE_DIRS = {".git", "data", "__pycache__", "node_modules"}
EXCLUDE_EXT = {".log"}
EXCLUDE_FILES = {".gitignore"}

if not os.path.isdir(SRC):
    print("ERROR: skill source not found:", SRC)
    sys.exit(1)

count = 0
with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as z:
    for dirpath, dirnames, filenames in os.walk(SRC):
        dirnames[:] = [d for d in dirnames if d not in EXCLUDE_DIRS]
        for fn in sorted(filenames):
            if fn in EXCLUDE_FILES:
                continue
            if os.path.splitext(fn)[1] in EXCLUDE_EXT:
                continue
            full = os.path.join(dirpath, fn)
            rel = os.path.relpath(full, SRC)
            arc = os.path.join("anymodel-for-claude-code", rel)
            z.write(full, arc)
            count += 1

print(f"Built {OUT}  ({count} files)")
