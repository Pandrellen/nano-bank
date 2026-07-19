from finance import roles


def test_reverse_map_covers_both_backends():
    assert roles.role_for_code("INT_INCOME") == "InterestIncome"
    assert roles.role_for_code("0000800100") == "InterestIncome"   # legacy saknr
    assert roles.role_for_code("ACCR_INT_PAY") == "AccruedInterestPayable"
    assert roles.role_for_code("0000220000") == "AccruedInterestPayable"
    assert roles.role_for_code("UNKNOWN") is None


def test_statement_classification():
    assert roles.STATEMENT_LINE["CardReceivable"] == "asset"
    assert roles.STATEMENT_LINE["CustomerDeposits"] == "liability"
    assert roles.STATEMENT_LINE["Capital"] == "equity"
    assert roles.STATEMENT_LINE["InterchangeIncome"] == "income"
    assert roles.STATEMENT_LINE["InterestExpense"] == "expense"


def test_earning_assets_exclude_cash_reserves():
    assert "CashReserves" not in roles.EARNING_ASSET_ROLES
    assert roles.EARNING_ASSET_ROLES == {
        "CardReceivable", "OverdraftReceivable", "LoansReceivable", "TreasuryPlacement",
    }
