# Design: CFO Entity/Claim Verifier

**Status:** Approved for planning
**Date:** 2026-07-23
**Author:** nano-bank team
**Scope:** Extend the CFO answer verifier from grounding *numbers* to grounding
*named-entity claims* — catching phantom entities (LCR/NPL/…), fabricated
periods/roles, and the "available period described as unavailable" bug.

## 1. Context and goals

The CFO answer verifier (spec `2026-07-22-cfo-answer-verifier-design.md`) grounds
every money/ratio **figure** in the CFO's answer against the numbers its tools
returned that turn. It works: a fabricated number gets flagged and the agent
revises once.

But grounding *numbers* leaves a gap. Asked about NIM, the CFO wrote:

> "`list_periods` shows only **2026-06** … 2026-07 may need to be closed first."

`list_periods` had in fact returned both `2026-06` and `2026-07`, and the CFO
had just read `2026-07`'s NIM in the same answer. This is a false **claim**, not
a false number — and the number verifier passed it clean, because `2026-06` /
`2026-07` are bare date tokens and the falsehood is about *which periods exist*.

This spec extends grounding to **named-entity claims**: assertions about which
periods, account roles, and metrics the tools actually surfaced.

### What is genuinely new (and what isn't)

The number verifier **already** catches fabricated entities that arrive *with a
number*: "LCR is 95%", "3% NPL", the "$7,652 loss" were all flagged on the
ungrounded number. The new coverage is claims **without** a number:

- a period-availability predicate ("2026-07 needs closing") — the observed bug;
- a phantom entity asserted qualitatively ("our liquidity looks weak").

### The false-positive that shapes the design

The CFO **must be able to name entities it is declining** — the premise-refusal
work exists so it says "I cannot see an LCR." A naïve "flag every mention of a
non-tool entity" check would punish that honest disclaimer. So the check must
separate an **affirmative** claim ("our LCR is weak") from a **disclaimer** ("I
can't see an LCR"). That is cue-based predicate detection: deterministic, no
LLM, but heuristic.

### Non-goals

- **No LLM in the verifier.** A model judging a model's claims has correlated
  errors — rejected earlier and here.
- **No tool-name or loose-synonym grounding.** "the loan book", "per the RAROC
  tool" — too fragile, low value (YAGNI).
- **No grounding of generic single-word roles** (`Bank`, `Revenue`, `Expense`,
  `Capital`, `Payable`, `Receivable`). They are ordinary English words; matching
  them in prose is all false positives. Only *distinctive* role labels
  (multi-word, e.g. "loans receivable") are grounded.
- **Not a general claim checker.** Only three entity types: period, role,
  metric.

## 2. Architecture

A new pure module `cfo/claims.py` holds the entity vocabulary, the grounded-set
builder, and the affirmative-vs-disclaimer cue classifier. `cfo/verifier.py`
stays focused on numbers and becomes the **aggregator**: `report()` now returns
number-grounding *and* the claim channel. `ask()`'s one-retry loop fires when
**either** channel has an issue.

```
ask(message)
  ├─ invoke agent (pass 1) ─────────────► answer_1, trace
  ├─ figs  = verifier.ungrounded(answer_1, trace)      # numbers
  ├─ clms  = claims.unsupported_claims(answer_1, trace) # entities
  ├─ if figs or clms:  (one retry)
  │     revise message names BOTH the ungrounded figures and the claims
  │     invoke agent (pass 2, same thread) ─► answer_2
  └─ return answer_2 + verifier.report(...)  # {grounded, ungrounded,
                                             #  unsupported_claims, revised}
```

### Components

- **`cfo/claims.py`** — new, pure:
  - `DOMAIN` — the closed vocabulary: `{label_regex → (canonical_id, type)}` for
    `role` and `metric`, plus the `PERIOD` pattern handled specially.
  - `grounded_entities(trace) -> set[str]` — canonical ids the tools surfaced
    this turn (role/metric keys found in tool outputs; periods from
    `list_periods` output and from tool inputs).
  - `unsupported_claims(answer, trace) -> list[str]` — human-readable issue
    strings for (a) affirmative references to un-grounded entities and (b)
    grounded periods described as unavailable.
  - private: `_sentences(text)`, `_is_disclaimed(sentence)`,
    `_period_called_unavailable(sentence)`.
- **`cfo/verifier.py`** — `report()` gains `unsupported_claims`;
  `revise_prompt(figures, claims)` gains the claims argument (default empty for
  the existing callers/tests).
- **`cfo/agent.py`** — `ask()` computes both channels, revises on either, builds
  the combined nudge.
- **`cfo/console.py`** — badge already reads the report; extend `badge()` to
  mention claim issues.

## 3. The vocabulary

Three entity types, each with a canonical id and the labels that map to it.

### Periods (`type=period`)
- Label: `\b20\d{2}-(0[1-9]|1[0-2])\b` (a `YYYY-MM`). Canonical = the matched
  string.

### Metrics (`type=metric`)
Tool-provided (canonical ids, from `finance.metrics`): `roa`, `roe`,
`efficiency_ratio`, `loan_to_deposit`, `leverage_ratio`, `rwa_capital_ratio`,
`cost_of_funds`, `yield_on_earning_assets`, `nim`, `raroc`, `expected_loss_rate`,
`credit_exposure`.

Known **phantom** metrics (no tool provides them — this is the high-value set):
`lcr` (labels: "lcr", "liquidity coverage ratio"), `nsfr` ("nsfr", "net stable
funding ratio"), `npl` ("npl", "non-performing loan(s)", "npl ratio").

Labels for tool-provided metrics include their common prose forms, e.g. `roe` ←
"roe", "return on equity"; `nim` ← "nim", "net interest margin". Matching is
case-insensitive, word-boundaried.

### Roles (`type=role`)
Canonical ids = `finance.roles.STATEMENT_LINE` keys. Labels are the
CamelCase-split spellings, **distinctive multi-word only**: "loans receivable",
"card receivable", "overdraft receivable", "customer deposits", "treasury
placement", "cash reserves", "accrued interest receivable", "accrued interest
payable", "interest income", "interest expense", "interchange income", "fee
income", "operating expense", "retained earnings", "input tax", "output tax".
The generic single-word roles are **excluded** (see Non-goals).

## 4. Grounded entity set

From the trace (tool events only):
- **roles / metrics**: a canonical id is grounded if it appears as a substring
  in any tool `output` (outputs are stringified dicts whose keys are the
  canonical ids, e.g. `'roe':`, `'LoansReceivable':`). Match on the canonical id
  string, case-sensitive for role keys, lower for metric keys.
- **periods**: the `YYYY-MM` tokens in any `list_periods` output, **plus** any
  `YYYY-MM` in a tool `input` (a tool called with `period=X` that returned a
  result proves `X` is available).

## 5. The two checks

Split the answer into sentences (`_sentences`: break on `.!?`, newlines, and
table-row boundaries `|`). For each sentence:

### (a) Affirmative-membership
For every entity label found in the sentence, resolve its canonical id. If the
id is **not** in the grounded set **and** the sentence is **not** a disclaimer
(`_is_disclaimed` finds no negation/inability cue), record an issue:
`"<label> — no tool provides this"`.

`_is_disclaimed(sentence)` is true when the sentence contains any cue from a
fixed lexicon: `cannot`, `can't`, `can not`, `cannot see`, `don't`, `do not`,
`does not`, `doesn't`, `not available`, `outside`, `unable`, `no … tool`, `not …
see/track/produce/capture/have`. (Matched as simple substrings / small regexes.)

### (b) Period-availability predicate
For every `YYYY-MM` in the sentence that **is** grounded, if the sentence also
contains an unavailability cue — `not closed`, `un-closed`, `unclosed`, `needs
to be closed`, `need(s) to close`, `may need to be closed`, `no snapshot`, `not
available`, `isn't closed`, `unavailable` — record an issue: `"<period>
described as unavailable, but a tool returned it"`.

(The observed bug — "…2026-07… may need to be closed first" — is caught here:
`2026-07` is grounded and the sentence carries "may need to be closed". A
weaker "only 2026-06" completeness signal is deliberately **not** used: it
targets an *omission* rather than a false predicate, which needs set-completeness
parsing and mis-fires more; the direct predicate rule already catches the bug.)

`unsupported_claims` returns the de-duplicated list of issue strings from both
checks.

## 6. Integration

- `verifier.report(answer, trace, *, revised)` →
  `{"grounded": [...], "ungrounded": [...], "unsupported_claims": [...],
    "revised": bool}`. It calls `claims.unsupported_claims` for the new field.
- `verifier.revise_prompt(figures, claims=())` — when `claims` is non-empty, the
  message adds: *"You also made claims not supported by your tools this turn:
  <claims>. Correct each — call the tool that settles it, or state plainly you
  cannot see it — and do not assert a period is unavailable if a tool returned
  data for it."*
- `ask()` revises when `figures or claims`; the nudge is built from both.
- `badge(report)` — `✓ all figures tool-grounded` only when both `ungrounded`
  and `unsupported_claims` are empty; otherwise a `⚠` line listing figure count
  and claim issues.

## 7. Testing

**Unit (`cfo/tests/test_claims.py`, pure):**
- `grounded_entities` collects periods from `list_periods` output and from tool
  inputs; collects role/metric ids from tool-output substrings.
- membership flags an **affirmative** phantom metric ("Our LCR is weak.") but
  **not** a disclaimer ("I cannot see an LCR.", "my tools don't produce NPL").
- membership flags a fabricated period referenced as real; passes a grounded
  role ("Loans Receivable of $400,000") when the role is in the trace.
- period-predicate flags a grounded period called "needs to be closed" / "only
  2026-06"; passes "2026-08 is not closed" when 2026-08 is **not** grounded
  (correct — it genuinely isn't available).
- generic single-word roles never match ("the bank is healthy" → no claim).

**Verifier (`cfo/tests/test_verifier.py`):**
- `report` includes `unsupported_claims`; `revise_prompt(figs, claims)` names
  both.

**Agent (`cfo/tests/test_agent.py`, mocked):**
- pass-1 answer with a bad period claim but no bad number → `ask()` revises
  (`revised True`), driven by the claim channel alone.

**Live smoke (`cfo/verify-cfo.sh`):**
- the existing premise-refusal question's response carries
  `unsupported_claims == []` (the CFO's honest "I can't see NPL" must **not**
  be flagged — the disclaimer guard, verified end to end).

## 8. Scope summary

In: `cfo/claims.py` (vocabulary, grounded set, two cue-based checks), the
`unsupported_claims` channel through `report`/`revise_prompt`/`ask`/`badge`, and
the tests above. Out: LLM checking, tool-name/synonym grounding, generic
single-word roles, entity types beyond period/role/metric. The heuristic's
mis-fires cost at most one revise turn — never a wrong figure or claim shipped —
and every rule is inspectable.
