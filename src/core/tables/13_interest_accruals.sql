-- Nano Bank Core Database Schema
-- Part 13: Interest accrual subledger + batch run ledgers (spec #2)

-- Per-account, per-day accrued interest. Aggregate GL is posted per day; this
-- keeps the per-account detail so monthly capitalisation and reports reconcile.
CREATE TABLE IF NOT EXISTS interest_accruals (
    accrual_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id        UUID NOT NULL REFERENCES accounts(account_id) ON DELETE RESTRICT,
    accrual_date      DATE NOT NULL,
    product           TEXT NOT NULL,            -- deposit|card|overdraft
    cost_centre       TEXT NOT NULL,            -- deposits|lending
    principal         DECIMAL(15,2) NOT NULL,   -- end-of-day balance the accrual is on
    rate              DECIMAL(5,4) NOT NULL,    -- annual rate used
    amount            DECIMAL(15,2) NOT NULL,   -- rounded daily interest
    side              TEXT NOT NULL,            -- 'expense' (deposit) | 'income' (asset)
    economic_event_id UUID NOT NULL,            -- = the accrual run's event id
    capitalised       BOOLEAN NOT NULL DEFAULT FALSE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_accrual_amount_precision CHECK (amount = ROUND(amount, 2))
);
-- One accrual per account per day (idempotency at row grain).
CREATE UNIQUE INDEX IF NOT EXISTS uq_interest_accruals_acct_date
    ON interest_accruals(account_id, accrual_date);
CREATE INDEX IF NOT EXISTS idx_interest_accruals_uncap
    ON interest_accruals(account_id) WHERE capitalised = FALSE;

-- One row per completed daily accrual batch. Presence of a 'completed' row for a
-- date makes re-running that date a no-op.
CREATE TABLE IF NOT EXISTS accrual_runs (
    accrual_date      DATE PRIMARY KEY,
    economic_event_id UUID NOT NULL,
    expense_total     DECIMAL(15,2) NOT NULL,
    income_total      DECIMAL(15,2) NOT NULL,
    status            TEXT NOT NULL DEFAULT 'completed',
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per completed monthly capitalisation batch (period = 'YYYY-MM').
CREATE TABLE IF NOT EXISTS capitalisation_runs (
    period            TEXT PRIMARY KEY,
    economic_event_id UUID NOT NULL,
    deposit_total     DECIMAL(15,2) NOT NULL,
    asset_total       DECIMAL(15,2) NOT NULL,
    maintenance_total DECIMAL(15,2) NOT NULL,
    status            TEXT NOT NULL DEFAULT 'completed',
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
