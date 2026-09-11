"""Read-only checks for repository documentation and session handoffs.

No product execution, network access, credential access or parent-directory
dependency. This validates structure, not the truth of completion claims.
"""
from pathlib import Path
import json
import re
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
SESSION_FIELDS = (
    "目标与授权", "接手基线", "实际变化与依据", "验证与未验证",
    "未完项与下一步", "文件同步与交付",
)


def main():
    paths = [ROOT / "AGENTS.md", ROOT / "README.md"]
    for directory in ("docs", "src", "tests"):
        paths.extend(sorted((ROOT / directory).rglob("*.md")))
    errors = []
    edges = {}
    for path in paths:
        relative = str(path.relative_to(ROOT))
        text = path.read_text()
        if text.count("```") % 2:
            errors.append(f"{relative}: unclosed code fence")
        prose = re.sub(r"```.*?```", "", text, flags=re.S)
        edges[relative] = set()
        for target in re.findall(r"\]\(([^)]+)\)", prose):
            target = target.strip().strip("<>")
            if urlsplit(target).scheme or target.startswith("#"):
                continue
            target = unquote(target.split("#", 1)[0])
            if not target:
                continue
            resolved = (path.parent / target).resolve()
            if not resolved.is_relative_to(ROOT):
                errors.append(f"{relative}: outside standalone repository: {target}")
            elif not resolved.exists():
                errors.append(f"{relative}: missing target: {target}")
            else:
                edges[relative].add(str(resolved.relative_to(ROOT)))

    required = {
        "AGENTS.md": ("docs/status.md", "docs/sessions/README.md"),
        "README.md": ("docs/status.md", "AGENTS.md"),
        "docs/status.md": ("sessions/README.md", "product-definition.md", "meeting-entry-spec.md"),
    }
    for relative, targets in required.items():
        text = (ROOT / relative).read_text()
        for target in targets:
            if f"]({target})" not in text:
                errors.append(f"{relative}: missing entry route: {target}")
    entry = (ROOT / "AGENTS.md").read_text()
    for stale in ("本次任务仅补齐文档", "本次后续请求明确授权", "首版可明确限制一个已验证桌面系统"):
        if stale in entry:
            errors.append(f"AGENTS.md: stale phase instruction: {stale}")
    index = (ROOT / "docs/sessions/README.md").read_text()
    records = sorted((ROOT / "docs/sessions").glob("*.md"))
    for path in records:
        if path.name in ("README.md", "template.md"):
            continue
        text = path.read_text()
        if f"]({path.name})" not in index:
            errors.append(f"session not indexed: {path.name}")
        for field in SESSION_FIELDS:
            if f"## {field}" not in text:
                errors.append(f"{path.name}: missing handoff field: {field}")
        for field in ("记录类型", "状态"):
            if field not in text:
                errors.append(f"{path.name}: missing {field}")

    # Current knowledge must be discoverable from the standalone entry points.
    seen, pending = set(), ["AGENTS.md", "README.md"]
    while pending:
        relative = pending.pop()
        if relative in seen:
            continue
        seen.add(relative)
        pending.extend(edges.get(relative, set()) - seen)
    for path in (ROOT / "docs").rglob("*.md"):
        relative = str(path.relative_to(ROOT))
        if relative not in seen:
            errors.append(f"documentation not reachable from entry: {relative}")
    print(json.dumps({"status": "failed" if errors else "passed",
                      "markdownFiles": len(paths), "sessionRecords": len(records) - 2,
                      "errors": errors, "scope": "local links, entry routes, session fields, reachability",
                      "productTests": "not run; structure does not verify claims"}, ensure_ascii=False))
    raise SystemExit(bool(errors))


if __name__ == "__main__":
    main()
