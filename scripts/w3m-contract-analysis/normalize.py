#!/usr/bin/env python3
"""Normalize Slither and Aderyn reports without asserting that a detector is a confirmed bug."""
from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path
from typing import Any


def read_json(path: str) -> Any:
    with Path(path).open("r", encoding="utf-8") as handle:
        return json.load(handle)


def severity(value: Any) -> str:
    text = str(value or "").strip().lower()
    if text in {"critical", "high", "medium", "low", "info", "informational"}:
        return "info" if text == "informational" else text
    if text in {"very high", "severe"}:
        return "critical"
    if text in {"moderate"}:
        return "medium"
    return "info"


def confidence(value: Any) -> str:
    text = str(value or "").strip().lower()
    if text in {"high", "medium", "low"}:
        return text
    return "unknown"


def first_text(obj: dict[str, Any], keys: tuple[str, ...]) -> str:
    for key in keys:
        value = obj.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def make_finding(engine: str, detector: str, title: str, description: str,
                 level: Any, certainty: Any, file_path: str,
                 start: Any, end: Any) -> dict[str, Any]:
    try:
        line_start = max(1, int(start)) if start is not None else None
    except (TypeError, ValueError):
        line_start = None
    try:
        line_end = max(line_start or 1, int(end)) if end is not None else line_start
    except (TypeError, ValueError):
        line_end = line_start
    clean_path = file_path.replace("\\", "/").lstrip("./") if file_path else ""
    identity = "|".join((engine, detector, clean_path, str(line_start or ""), title.lower()))
    fingerprint = hashlib.sha256(identity.encode("utf-8")).hexdigest()[:24]
    return {
        "engine": engine,
        "detector": detector or "unspecified",
        "title": title or detector or "Static-analysis finding",
        "severity": severity(level),
        "confidence": confidence(certainty),
        "file_path": clean_path or None,
        "line_start": line_start,
        "line_end": line_end,
        "description": description,
        "fingerprint": fingerprint,
        "triage_status": "needs_ai_triage",
        "confirmed": False,
    }


def normalize_slither(data: Any) -> list[dict[str, Any]]:
    if not isinstance(data, dict):
        return []
    results = data.get("results") if isinstance(data.get("results"), dict) else {}
    detectors = results.get("detectors", [])
    findings: list[dict[str, Any]] = []
    seen: set[str] = set()
    if not isinstance(detectors, list):
        return findings
    for detector in detectors:
        if not isinstance(detector, dict):
            continue
        check = first_text(detector, ("check", "id", "detector"))
        title = first_text(detector, ("title", "check")) or check
        desc = first_text(detector, ("description", "message"))
        impact = detector.get("impact")
        certainty = detector.get("confidence")
        elements = detector.get("elements")
        elements = elements if isinstance(elements, list) else []
        locations = []
        for element in elements:
            if not isinstance(element, dict):
                continue
            mapping = element.get("source_mapping")
            mapping = mapping if isinstance(mapping, dict) else {}
            lines = mapping.get("lines") if isinstance(mapping.get("lines"), list) else []
            locations.append((
                first_text(mapping, ("filename_relative", "filename_short", "filename_used")),
                lines[0] if lines else None,
                lines[-1] if lines else None,
            ))
        if not locations:
            locations = [("", None, None)]
        for path, start, end in locations:
            item = make_finding("slither", check, title, desc, impact,
                                certainty, path, start, end)
            # Slither can repeat the same detector/location across compilation
            # units or overlapping source elements. Keep one candidate per fingerprint.
            if item["fingerprint"] not in seen:
                seen.add(item["fingerprint"])
                findings.append(item)
    return findings


def walk_objects(value: Any):
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from walk_objects(child)
    elif isinstance(value, list):
        for child in value:
            yield from walk_objects(child)


def normalize_aderyn(data: Any) -> list[dict[str, Any]]:
    """Normalize current Aderyn issue buckets and tolerate older nested schemas."""
    findings: list[dict[str, Any]] = []
    seen: set[str] = set()

    # Aderyn 0.6.x emits high_issues/low_issues as objects containing
    # an "issues" array. Each issue then contains one or more source instances.
    if isinstance(data, dict):
        bucket_levels = (
            ("critical_issues", "critical"),
            ("high_issues", "high"),
            ("medium_issues", "medium"),
            ("low_issues", "low"),
            ("info_issues", "info"),
            ("informational_issues", "info"),
        )
        for bucket, level in bucket_levels:
            container = data.get(bucket)
            issues = container.get("issues") if isinstance(container, dict) else container
            if not isinstance(issues, list):
                continue
            for issue in issues:
                if not isinstance(issue, dict):
                    continue
                title = first_text(issue, ("title", "name", "issue", "detector_name"))
                detector = first_text(issue, ("detector_name", "detector", "detector_id", "id", "code", "name"))
                desc = first_text(issue, ("description", "message", "recommendation"))
                instances = issue.get("instances")
                if not isinstance(instances, list) or not instances:
                    instances = [issue]
                for instance in instances:
                    if not isinstance(instance, dict):
                        continue
                    file_path = first_text(instance, ("contract_path", "file_path", "filename", "file", "path"))
                    location = instance.get("location")
                    location = location if isinstance(location, dict) else {}
                    if not file_path:
                        file_path = first_text(location, ("contract_path", "file_path", "filename", "file", "path"))
                    start = instance.get("line_no", instance.get("line_start", instance.get("line", instance.get("start_line"))))
                    if start is None:
                        start = location.get("line_no", location.get("line_start", location.get("line")))
                    end = instance.get("line_end", instance.get("end_line", start))
                    item = make_finding("aderyn", detector, title, desc, level,
                                        issue.get("confidence", "unknown"), file_path, start, end)
                    if item["fingerprint"] not in seen:
                        seen.add(item["fingerprint"])
                        findings.append(item)

    # Compatibility path for older or alternate Aderyn JSON layouts.
    if findings:
        return findings
    for obj in walk_objects(data):
        title = first_text(obj, ("title", "name", "issue", "detector_name"))
        detector = first_text(obj, ("detector", "detector_id", "id", "code", "name"))
        desc = first_text(obj, ("description", "message", "recommendation"))
        level = first_text(obj, ("severity", "impact", "level", "risk"))
        if not title or not (desc or detector) or not level:
            continue
        location = obj.get("location")
        location = location if isinstance(location, dict) else {}
        source = obj.get("source_location")
        source = source if isinstance(source, dict) else {}
        file_path = first_text(obj, ("file_path", "filename", "file", "path"))
        if not file_path:
            file_path = first_text(location, ("file_path", "filename", "file", "path"))
        if not file_path:
            file_path = first_text(source, ("file_path", "filename", "file", "path"))
        start = obj.get("line_start", obj.get("line", obj.get("start_line")))
        end = obj.get("line_end", obj.get("end_line", start))
        if start is None:
            start = location.get("line_start", location.get("line", source.get("line_start", source.get("line"))))
        if end is None:
            end = location.get("line_end", source.get("line_end", start))
        certainty = obj.get("confidence", obj.get("certainty", "unknown"))
        item = make_finding("aderyn", detector, title, desc, level,
                            certainty, file_path, start, end)
        if item["fingerprint"] not in seen:
            seen.add(item["fingerprint"])
            findings.append(item)
    return findings


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--slither", required=True)
    parser.add_argument("--aderyn", required=True)
    parser.add_argument("--repository", required=True)
    parser.add_argument("--commit", required=True)
    parser.add_argument("--audit-id", default=None)
    parser.add_argument("--slither-exit", type=int, default=0)
    parser.add_argument("--aderyn-exit", type=int, default=0)
    parser.add_argument("--aderyn-status", choices=("completed", "unsupported_evm_target", "failed"), default="completed")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    slither_data = read_json(args.slither)
    aderyn_data = read_json(args.aderyn)
    findings = normalize_slither(slither_data) + normalize_aderyn(aderyn_data)
    severity_rank = {"critical": 0, "high": 1, "medium": 2, "low": 3, "info": 4}
    confidence_rank = {"high": 0, "medium": 1, "low": 2, "unknown": 3}
    # Put the most actionable candidates first so downstream AI prompts and
    # bounded database persistence do not get crowded out by informational noise.
    findings.sort(key=lambda item: (
        severity_rank.get(item["severity"], 9),
        confidence_rank.get(item["confidence"], 9),
        item["file_path"] or "",
        item["line_start"] or 0,
        item["engine"],
        item["detector"],
    ))
    by_engine = {
        "slither": sum(1 for item in findings if item["engine"] == "slither"),
        "aderyn": sum(1 for item in findings if item["engine"] == "aderyn"),
    }
    # Shared file/line is a review correlation hint only, never automatic deduplication.
    groups: dict[str, list[str]] = {}
    for item in findings:
        if item["file_path"] and item["line_start"]:
            key = f'{item["file_path"]}:{item["line_start"]}'
            groups.setdefault(key, []).append(item["engine"])
    correlations = [
        {"location": key, "engines": sorted(set(engines))}
        for key, engines in sorted(groups.items()) if len(set(engines)) > 1
    ]
    report = {
        "schema_version": "w3m.static-analysis.v1",
        "repository": args.repository,
        "commit_sha": args.commit,
        "audit_id": args.audit_id,
        "analysis_scope": "solidity_static_analysis",
        "engines": {
            "slither": {"version": "0.11.6", "status": "completed", "process_exit_code": args.slither_exit},
            "aderyn": {"version": "0.6.8", "status": args.aderyn_status, "process_exit_code": args.aderyn_exit},
        },
        "summary": {
            "finding_candidates": len(findings),
            "by_engine": by_engine,
            "cross_engine_location_correlations": len(correlations),
            "confirmed_vulnerabilities": 0,
            "requires_ai_or_human_triage": True,
        },
        "cross_engine_correlations": correlations,
        "findings": findings,
        "limitations": [
            "Static-analysis output is a set of candidates, not proof of exploitability.",
            "A shared file/line location is only a correlation hint; findings are not automatically merged.",
            "Compilation failures, missing dependencies, unsupported compiler versions, and skipped paths must be reviewed in raw logs.",
            "This workflow does not perform fuzzing, symbolic execution, deployment simulation, or formal verification.",
        ],
    }
    Path(args.output).write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
