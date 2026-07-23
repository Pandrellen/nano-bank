from cfo import claims


def test_grounded_periods_from_list_periods_output_and_tool_inputs():
    trace = [
        {"kind": "tool", "name": "list_periods", "input": "{}",
         "output": "['2026-06', '2026-07']"},
        {"kind": "tool", "name": "nim", "input": "{'period': '2026-07'}",
         "output": "{'nim': '0.0628'}"},
        {"kind": "model", "name": "model", "input": None, "output": None},
    ]
    assert claims.grounded_periods(trace) == {"2026-06", "2026-07"}


def test_grounded_periods_ignores_non_period_numbers():
    trace = [{"kind": "tool", "name": "raroc", "input": "{'period': '2026-07'}",
              "output": "{'raroc': '0.151', 'total_rwa': '2026000'}"}]
    assert claims.grounded_periods(trace) == {"2026-07"}


def test_sentences_split_on_enders_newlines_and_pipes():
    text = "First point. Second one!\nThird | fourth"
    assert claims._sentences(text) == ["First point", "Second one",
                                       "Third", "fourth"]


def test_cue_regexes_match_expected_phrases():
    assert claims._DISCLAIMER.search("I cannot see an LCR")
    assert claims._DISCLAIMER.search("my tools don't produce that")
    assert not claims._DISCLAIMER.search("our LCR is weak")
    assert claims._UNAVAIL.search("2026-07 may need to be closed first")
    assert not claims._UNAVAIL.search("2026-07 NIM is 6.28%")
    assert claims._OFFER.search("I can close 2026-08 for you")
    assert claims._OFFER.search("would you like me to close it")
    assert not claims._OFFER.search("2026-08 is closed")


def test_phantoms_cover_lcr_nsfr_npl():
    keys = set(claims._PHANTOMS)
    assert "lcr" in keys and "npl" in keys and "nsfr" in keys
