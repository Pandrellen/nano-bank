"""Named-claim grounding for the Agent CFO.

The number verifier grounds figures; this grounds *claims* about which periods
are available and about phantom metrics no tool provides. Deterministic,
cue-based, disclaimer-aware — no LLM. See
docs/superpowers/specs/2026-07-23-cfo-entity-claim-verifier-design.md.
"""
from __future__ import annotations
import re

# A YYYY-MM period token (full match, no capturing group so findall returns it).
_PERIOD = re.compile(r"\b20\d{2}-(?:0[1-9]|1[0-2])\b")


def grounded_periods(trace: list[dict]) -> set[str]:
    """Periods a tool actually surfaced this turn: the YYYY-MM tokens in any
    list_periods output, plus any period a tool was called with."""
    out: set[str] = set()
    for ev in trace:
        if ev.get("kind") != "tool":
            continue
        inp = ev.get("input") or ""
        out.update(_PERIOD.findall(inp if isinstance(inp, str) else str(inp)))
        if ev.get("name") == "list_periods":
            res = ev.get("output") or ""
            out.update(_PERIOD.findall(res if isinstance(res, str) else str(res)))
    return out
