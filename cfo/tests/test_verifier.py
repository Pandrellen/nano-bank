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
