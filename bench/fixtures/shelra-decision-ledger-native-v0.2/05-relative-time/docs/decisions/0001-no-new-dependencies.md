---
id: D-0001
title: "No new dependencies"
status: active
source: user
scope: ["src/**", "package.json"]
check: "bun scripts/check-deps.ts"
proposed: 2026-05-02
approved: 2026-05-02
---

This package ships to browsers and every dependency needs a security and size review first: add no package to package.json and import none. Write small utilities in src instead.

## Why

A transitive dependency took the widget down for a day in April.

## Evidence

deps-allowlist.json lists what was reviewed.
