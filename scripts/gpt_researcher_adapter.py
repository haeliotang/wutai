#!/usr/bin/env python3
"""Run GPT Researcher and return a Wutai-shaped JSON payload."""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import json
import sys
from importlib import metadata
from typing import Any

PROGRESS_PREFIX = "WUTAI_PROGRESS "


def _emit_progress(phase: str, message: str) -> None:
    payload = json.dumps({"phase": phase, "message": message}, ensure_ascii=False)
    print(f"{PROGRESS_PREFIX}{payload}", file=sys.stderr, flush=True)


def _stringify(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    return str(value)


def _compact_note(value: Any, limit: int = 280) -> str:
    text = _stringify(value).replace("\n", " ").strip()
    if len(text) <= limit:
        return text
    return f"{text[: limit - 1].rstrip()}..."


def _source_from_mapping(source: dict[str, Any]) -> dict[str, str] | None:
    url = _stringify(
        source.get("url")
        or source.get("source")
        or source.get("href")
        or source.get("link")
    ).strip()
    if not url:
        return None

    title = _stringify(source.get("title") or source.get("name") or url).strip()
    note = _compact_note(
        source.get("summary")
        or source.get("content")
        or source.get("raw_content")
        or source.get("snippet")
        or "Captured by GPT Researcher."
    )

    return {"title": title, "url": url, "note": note}


def _normalize_sources(raw_sources: Any, source_urls: Any) -> list[dict[str, str]]:
    candidates: list[Any] = []

    if isinstance(raw_sources, list):
        candidates.extend(raw_sources)
    if isinstance(source_urls, list):
        candidates.extend(source_urls)

    normalized: list[dict[str, str]] = []
    seen_urls: set[str] = set()

    for source in candidates:
        if isinstance(source, dict):
            item = _source_from_mapping(source)
        else:
            url = _stringify(source).strip()
            item = {"title": url, "url": url, "note": "Captured by GPT Researcher."} if url else None

        if item is None or item["url"] in seen_urls:
            continue

        seen_urls.add(item["url"])
        normalized.append(item)

    return normalized


def _package_version(package_name: str) -> str | None:
    try:
        return metadata.version(package_name)
    except metadata.PackageNotFoundError:
        return None


async def _run(task_id: str, query: str, report_type: str, tone: str) -> dict[str, Any]:
    _emit_progress("initializing", "Preparing the research runtime.")
    try:
        from gpt_researcher import GPTResearcher
    except ImportError as error:
        raise RuntimeError(
            "Missing Python package `gpt-researcher`. Install optional sidecar "
            "dependencies with `python3.11 -m pip install -r requirements-gpt-researcher.txt`."
        ) from error

    researcher = GPTResearcher(query=query, report_type=report_type, tone=tone)
    _emit_progress("researching", "Searching and reading public sources.")
    await researcher.conduct_research()
    _emit_progress("drafting", "Drafting the sourced research report.")
    report = await researcher.write_report()

    _emit_progress("finalizing", "Organizing sources and audit details.")
    research_sources = researcher.get_research_sources()
    source_urls = researcher.get_source_urls()
    research_costs = researcher.get_costs()

    return {
        "report": report,
        "sources": _normalize_sources(research_sources, source_urls),
        "audit": {
            "adapter": "gpt-researcher",
            "taskId": task_id,
            "gptResearcherVersion": _package_version("gpt-researcher"),
            "reportType": report_type,
            "tone": tone,
            "costs": research_costs,
            "sourceCount": len(research_sources or []),
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--task-id", required=True)
    parser.add_argument("--query", required=True)
    parser.add_argument("--report-type", default="research_report")
    parser.add_argument("--tone", default="objective")
    args = parser.parse_args()

    try:
        with contextlib.redirect_stdout(sys.stderr):
            result = asyncio.run(_run(args.task_id, args.query, args.report_type, args.tone))
    except Exception as error:
        print(str(error), file=sys.stderr)
        return 1

    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
