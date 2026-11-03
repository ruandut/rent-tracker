from apps.ledger.models import RentalUnit


def test_readings_normalise_period_and_reject_duplicates(api):
    unit = RentalUnit.objects.create(name="A")
    body = {"rental_unit": unit.id, "kind": "water", "period": "2026-03-17", "usage": "12.5"}
    res = api.post("/api/readings/", body, format="json")
    assert res.status_code == 201, res.json()
    assert res.json()["period"] == "2026-03-01"
    assert (
        api.post("/api/readings/", {**body, "period": "2026-03-02"}, format="json").status_code
        == 400
    )


def test_charges_filter_by_unit_and_range(api):
    a = RentalUnit.objects.create(name="A")
    b = RentalUnit.objects.create(name="B")
    for unit, period in [(a, "2026-01-01"), (a, "2026-05-01"), (b, "2026-05-01")]:
        api.post(
            "/api/charges/",
            {"rental_unit": unit.id, "category": "rates_taxes", "period": period, "amount": "100"},
            format="json",
        )
    # A range starting mid-month still includes that month.
    rows = api.get("/api/charges/", {"unit": a.id, "date_from": "2026-05-15"}).json()
    assert [r["period"] for r in rows] == ["2026-05-01"]
