"""Deterministic answer verifier for the Agent CFO.

Every money/ratio figure the CFO states must trace to a number some tool
returned this turn. The trace of tool outputs is the oracle; there is no LLM
here. See docs/superpowers/specs/2026-07-22-cfo-answer-verifier-design.md.
"""
from __future__ import annotations
import re
from decimal import Decimal, InvalidOperation

# A signed number literal: comma-grouped (1,448.08) or plain (9100.00 / 510000),
# with an optional decimal part. Unicode minus is normalised before matching.
_NUM = re.compile(r"-?\d{1,3}(?:,\d{3})+(?:\.\d+)?|-?\d+(?:\.\d+)?")


def _to_decimal(raw: str) -> "Decimal | None":
    try:
        return Decimal(raw.replace("−", "-").replace(",", ""))
    except InvalidOperation:
        return None


def grounded_values(trace: list[dict]) -> list[Decimal]:
    """Every numeric literal appearing in any tool output in the trace."""
    out: list[Decimal] = []
    for ev in trace:
        if ev.get("kind") != "tool":
            continue
        raw = ev.get("output")
        if not raw:
            continue
        text = raw if isinstance(raw, str) else str(raw)
        for m in _NUM.findall(text.replace("−", "-")):
            d = _to_decimal(m)
            if d is not None:
                out.append(d)
    return out


# One pass, non-overlapping, left to right. Alternation order matters: money and
# percent win over the bare-decimal branch so "$1,448.08" is money, not a plain
# decimal. `_DEC` only matches comma-grouped OR >=2-decimal numbers, so bare
# integers (years, counts) never match any branch and stay exempt.
_FIG = re.compile(
    r"(?P<money>[-−]?\$\s?\d[\d,]*(?:\.\d+)?)"
    r"|(?P<pct>[-−]?\d[\d,]*(?:\.\d+)?\s?%)"
    r"|(?P<dec>[-−]?\d{1,3}(?:,\d{3})+(?:\.\d+)?|[-−]?\d+\.\d{2,})"
)


class Figure:
    __slots__ = ("text", "value", "is_percent", "decimals")

    def __init__(self, text: str, value: Decimal, is_percent: bool,
                 decimals: int):
        self.text = text
        self.value = value
        self.is_percent = is_percent
        self.decimals = decimals

    def __repr__(self) -> str:  # aids test failure messages
        return f"Figure({self.text!r}, {self.value}, pct={self.is_percent})"


def _decimals_of(text: str) -> int:
    if "." not in text:
        return 0
    return len(text.rsplit(".", 1)[1].rstrip("%").strip())


def claimed_figures(answer: str) -> list[Figure]:
    figs: list[Figure] = []
    for m in _FIG.finditer(answer):
        text = m.group(0)
        is_percent = m.lastgroup == "pct"
        cleaned = text.replace("−", "-").replace("$", "").replace("%", "")
        cleaned = cleaned.replace(",", "").strip()
        value = _to_decimal(cleaned)
        if value is None:
            continue
        figs.append(Figure(text, value, is_percent, _decimals_of(text)))
    return figs


def _close(grounded: Decimal, target: Decimal, decimals: int) -> bool:
    """True if a grounded value equals the target at the figure's displayed
    precision. Tolerance is half of the last shown decimal place, OR 0.1% of
    the target for large rounded figures — whichever is larger."""
    place = Decimal(5) * (Decimal(10) ** -(decimals + 1))   # half last digit
    rel = abs(target) * Decimal("0.001")                    # 0.1% presentation
    tol = place if place > rel else rel
    return abs(grounded - target) <= tol


def _is_grounded(fig: Figure, grounded: list[Decimal]) -> bool:
    targets = [fig.value]
    if fig.is_percent:
        # tools store the ratio; prose shows the percent
        targets.append(fig.value / Decimal(100))
    for t in targets:
        for g in grounded:
            if _close(g, t, fig.decimals):
                return True
    return False


def ungrounded(answer: str, trace: list[dict]) -> list[str]:
    """The prose figures that match no number any tool returned this turn."""
    grounded = grounded_values(trace)
    return [f.text for f in claimed_figures(answer)
            if not _is_grounded(f, grounded)]
