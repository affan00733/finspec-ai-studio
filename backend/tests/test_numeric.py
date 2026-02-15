from decimal import Decimal

from engine.numeric import (
    detect_currency, detect_emission_unit, detect_scale, find_amounts, parse_number, values_agree,
)


def test_parse_number_variants():
    assert parse_number("1,234.5") == Decimal("1234.5")
    assert parse_number("(1,234.5)") == Decimal("-1234.5")
    assert parse_number("-12") == Decimal("-12")
    assert parse_number("1.234,5") == Decimal("1234.5")
    assert parse_number("12,5") == Decimal("12.5")
    assert parse_number("$ 4,000") == Decimal("4000")
    assert parse_number("7,908.0¹") == Decimal("7908.0")


def test_parse_number_rejects_non_numbers():
    for bad in ("", "n/a", "—", "abc", "12 apples", "1,2,3", "FY2024", None):
        assert parse_number(bad) is None


def test_scale_and_currency_detection():
    assert detect_scale("(USD millions)") == Decimal(10) ** 6
    assert detect_scale("EUR thousands") == Decimal(10) ** 3
    assert detect_scale("amounts in £bn") == Decimal(10) ** 9
    assert detect_scale("no unit here") is None
    assert detect_currency("Amounts in €") == "EUR"
    assert detect_currency("USD millions") == "USD"
    assert detect_currency("pounds sterling") == "GBP"


def test_emission_units():
    assert detect_emission_unit("(ktCO2e)") == (Decimal(1000), "ktCO2e")
    assert detect_emission_unit("tCO2e") == (Decimal(1), "tCO2e")
    assert detect_emission_unit("(million tCO2e)")[0] == Decimal(10) ** 6
    assert detect_emission_unit("1.2 million tonnes of CO2e")[0] == Decimal(10) ** 6
    assert detect_emission_unit("MtCO2e")[0] == Decimal(10) ** 6
    assert detect_emission_unit("revenue in dollars") is None


def test_find_amounts_inline_scale_and_percent():
    amts = find_amounts("Revenue increased 5.2% to $1,234.5 million in 2024")
    pct = [a for a in amts if a.percent]
    money = [a for a in amts if a.currency == "USD"]
    assert pct and pct[0].number == Decimal("5.2")
    assert money[0].number == Decimal("1234.5") and money[0].scale == Decimal(10) ** 6 and money[0].decimals == 1


def test_values_agree_respects_rounding():
    # 3,187,380 thousand vs the rounded narrative figure 3,187.4 million
    assert values_agree(Decimal(3187380000), Decimal(1000), Decimal(3187400000), Decimal(100000))
    assert not values_agree(Decimal(3187380000), Decimal(1000), Decimal(3200000000), Decimal(100000))
