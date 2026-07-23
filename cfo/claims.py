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


# Break on sentence enders, newlines, and table-row pipes so a cue and a token
# in the same clause stay together but separate clauses don't bleed.
_SPLIT = re.compile(r"[.!?\n|]+")


def _sentences(text: str) -> list[str]:
    return [s.strip() for s in _SPLIT.split(text) if s.strip()]


# A negation / inability cue: the CFO honestly declining an entity it can't see.
_DISCLAIMER = re.compile(
    r"\b(can ?not|can'?t|do not|don'?t|does not|doesn'?t|unable|outside"
    r"|not available|no\b[^.]*\btool"
    r"|not\b[^.]*\b(?:see|track|produce|capture|have|show))\b",
    re.I)

# A period being called unavailable / unclosed.
_UNAVAIL = re.compile(
    r"\b(not closed|un-?closed|need(?:s)? to (?:be )?closed?"
    r"|may need to (?:be )?closed?|no snapshot|not available|isn'?t closed"
    r"|unavailable)\b",
    re.I)

# A legitimate offer to act on a period — must not be read as a fabrication.
_OFFER = re.compile(
    r"\b(would you like|if you'?d like|want me to|shall i|let me know"
    r"|i can (?:close|run|capture))\b",
    re.I)

# Metrics no tool provides. label (regex-safe substring) -> shown name.
_PHANTOMS = {
    "liquidity coverage ratio": "liquidity coverage ratio",
    "lcr": "LCR",
    "net stable funding ratio": "net stable funding ratio",
    "nsfr": "NSFR",
    "npl ratio": "NPL ratio",
    "non-performing loan": "non-performing loan",
    "non performing loan": "non-performing loan",
    "npl": "NPL",
}
