from decimal import Decimal as D
from cfo import verifier


def test_grounded_values_parses_numbers_from_tool_outputs():
    trace = [
        {"kind": "tool", "name": "raroc",
         "output": "{'raroc': '0.151', 'expected_loss': '9100.00', "
                   "'credit_exposure': '510000'}"},
        {"kind": "model", "name": "model", "output": None},
        {"kind": "tool", "name": "key_ratios",
         "output": "{'roe': '0.2131', 'roa': '0.0209'}"},
    ]
    vals = verifier.grounded_values(trace)
    assert D("0.151") in vals
    assert D("9100.00") in vals
    assert D("510000") in vals
    assert D("0.2131") in vals


def test_grounded_values_ignores_model_events_and_empty_output():
    trace = [
        {"kind": "model", "name": "model", "output": None},
        {"kind": "tool", "name": "t", "output": ""},
    ]
    assert verifier.grounded_values(trace) == []


def test_claimed_figures_extracts_money_percent_and_formatted_decimals():
    ans = ("ROE was 21.31% on net income of $1,448.08; total assets "
           "$815,636.08. Efficiency 59.7%. A loss of -$2,551.92.")
    figs = {f.text: f for f in verifier.claimed_figures(ans)}
    assert "21.31%" in figs and figs["21.31%"].is_percent
    assert figs["21.31%"].value == D("21.31")
    assert figs["21.31%"].decimals == 2
    assert "$1,448.08" in figs and figs["$1,448.08"].value == D("1448.08")
    assert not figs["$1,448.08"].is_percent
    assert "$815,636.08" in figs
    assert "59.7%" in figs and figs["59.7%"].decimals == 1
    assert figs["-$2,551.92"].value == D("-2551.92")


def test_claimed_figures_exempts_bare_integers():
    ans = ("For 2026-07 the snapshot captured 16 roles across a 31-day "
           "period; 365 days in a year. No dollar or percent here.")
    assert verifier.claimed_figures(ans) == []


def test_claimed_figures_handles_unicode_minus():
    ans = "ROA swung to −3.70% this month."
    figs = verifier.claimed_figures(ans)
    assert len(figs) == 1
    assert figs[0].is_percent
    assert figs[0].value == D("-3.70")


def _trace(*outputs):
    return [{"kind": "tool", "name": "t", "output": o} for o in outputs]


def test_ungrounded_flags_a_fabricated_figure():
    """The $7,652 'monthly loss' the CFO invented appears in no tool output."""
    trace = _trace("{'net_income': '1448.08', 'roe': '0.2131'}")
    ans = "Net income was $1,448.08, but after the loss it is -$7,652.00."
    assert verifier.ungrounded(ans, trace) == ["-$7,652.00"]


def test_percent_matches_ratio_form_within_rounding():
    """Tools store ratios (0.213108); prose states 21.31% or 21.3%."""
    trace = _trace("{'roe': '0.213108'}")
    assert verifier.ungrounded("ROE is 21.31%.", trace) == []
    assert verifier.ungrounded("ROE is 21.3%.", trace) == []


def test_currency_matches_after_separator_strip():
    trace = _trace("{'total_assets': '815636.08'}")
    assert verifier.ungrounded("Total assets $815,636.08.", trace) == []


def test_grounded_and_ungrounded_together():
    trace = _trace("{'roe': '0.2131', 'net_income': '1448.08'}")
    ans = "ROE 21.31% on $1,448.08, and an invented 42.0% efficiency."
    assert verifier.ungrounded(ans, trace) == ["42.0%"]
