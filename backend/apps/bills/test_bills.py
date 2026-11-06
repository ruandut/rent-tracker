from datetime import date
from decimal import Decimal

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile

from apps.bills.models import Bill, BillTemplate
from apps.bills.serializers import TemplateDefinitionSerializer
from apps.ledger.models import RentalUnit
from apps.utilities.models import MunicipalCharge, UtilityReading

URL = "/api/bills/"


@pytest.fixture
def units(db):
    return RentalUnit.objects.create(name="Main"), RentalUnit.objects.create(name="Flat")


def line(section, excl, vat="0", **extra):
    return {"section": section, "amount_excl": excl, "vat": vat, **extra}


def body(units, **overrides):
    main, flat = units
    return {
        "template": BillTemplate.objects.get(is_default=True).id,
        "period": "2026-10-23",
        "account_number": "1001",
        "stated_total": "1059.98",
        "raw_text": "the bill as it arrived",
        "units": [
            {
                "rental_unit": main.id,
                "lines": [
                    line("rates", "1000.00", description="Residential"),
                    line("rates", "-100.00", charge_type="rebate", description="Rebate"),
                    line("water", "100.00", "15.00", charge_type="basic", meter_number="W1"),
                    line(
                        "water",
                        "20.00",
                        "3.00",
                        charge_type="usage",
                        meter_number="W1",
                        meter_current="1428.000",
                        usage="14.000",
                    ),
                ],
            },
            {
                "rental_unit": flat.id,
                "lines": [line("electricity", "19.98", "2.00", charge_type="basic")],
            },
        ],
        **overrides,
    }


def test_one_printed_bill_splits_between_units_and_fills_both_tables(api, units):
    main, flat = units
    res = api.post(URL, body(units), format="json")
    assert res.status_code == 201, res.json()
    data = res.json()
    assert data["period"] == "2026-10-01"
    assert [unit["rental_unit_name"] for unit in data["units"]] == ["Main", "Flat"]
    assert [row["section"] for row in data["units"][0]["lines"]][:2] == ["rates", "rates"]
    assert data["total"] == pytest.approx(1059.98)
    assert data["units"][1]["total"] == pytest.approx(21.98)
    assert data["total_vat"] == pytest.approx(20)
    assert data["services"]["Water"]["usage"] == pytest.approx(14)

    water = UtilityReading.objects.get(kind="water")
    assert (water.rental_unit, water.usage, water.cost) == (
        main,
        Decimal("14.00"),
        Decimal("138.00"),
    )
    assert water.meter_reading == Decimal("1428.00")
    assert water.bill_id == data["id"]

    # Prepaid electricity is billed with no usage: the row says unknown, not zero.
    electricity = UtilityReading.objects.get(kind="electricity")
    assert (electricity.rental_unit, electricity.usage) == (flat, None)
    charge = MunicipalCharge.objects.get()
    assert (charge.rental_unit, charge.amount) == (main, Decimal("900.00"))


def test_any_number_of_units_can_share_a_bill(api, units):
    third = RentalUnit.objects.create(name="Third")
    payload = body(units)
    payload["units"].append({"rental_unit": third.id, "lines": [line("water", "5.00")]})
    assert api.post(URL, payload, format="json").status_code == 201
    assert UtilityReading.objects.filter(rental_unit=third).count() == 1


def test_a_bill_needs_a_unit(api, units):
    assert api.post(URL, {**body(units), "units": []}, format="json").status_code == 400


def test_a_unit_appears_once_on_a_bill(api, units):
    payload = body(units)
    payload["units"][1]["rental_unit"] = units[0].id
    res = api.post(URL, payload, format="json")
    assert res.status_code == 400
    assert "only appear once" in str(res.json())


def test_a_bill_needs_an_account_number(api, units):
    assert api.post(URL, body(units, account_number=""), format="json").status_code == 400


def test_a_unit_on_a_bill_cannot_be_deleted(api, units):
    api.post(URL, body(units), format="json")
    res = api.delete(f"/api/units/{units[0].id}/")
    assert res.status_code == 400
    assert "municipal bills" in res.json()["detail"]


def test_two_meters_on_one_unit_add_up_without_a_single_reading(api, units):
    payload = body(units)
    payload["units"] = [
        {
            "rental_unit": units[0].id,
            "lines": [
                line("water", "10", meter_number="W1", meter_current="10", usage="14"),
                line("water", "10", meter_number="W2", meter_current="20", usage="13"),
            ],
        }
    ]
    assert api.post(URL, payload, format="json").status_code == 201
    reading = UtilityReading.objects.get()
    assert (reading.usage, reading.meter_reading) == (Decimal("27.00"), None)


def test_editing_a_bill_updates_rows_in_place_and_drops_stale_ones(api, units):
    main, flat = units
    bill = api.post(URL, body(units), format="json").json()
    charge_id = MunicipalCharge.objects.get().id

    res = api.patch(
        f"{URL}{bill['id']}/",
        {
            "period": "2026-11-01",
            "units": [
                {
                    "rental_unit": main.id,
                    "lines": [line("rates", "750.00"), line("water", "10.00")],
                }
            ],
        },
        format="json",
    )

    assert res.status_code == 200, res.json()
    assert len(res.json()["units"]) == 1
    charge = MunicipalCharge.objects.get()
    assert (charge.id, charge.amount) == (charge_id, Decimal("750.00"))
    assert charge.period.isoformat() == "2026-11-01"
    # The flat left the bill, so its electricity reading goes too.
    assert not UtilityReading.objects.filter(rental_unit=flat).exists()


def test_a_header_only_edit_keeps_the_units(api, units):
    bill = api.post(URL, body(units), format="json").json()
    res = api.patch(f"{URL}{bill['id']}/", {"notes": "paid"}, format="json")
    assert res.status_code == 200, res.json()
    assert len(res.json()["units"]) == 2
    assert UtilityReading.objects.count() == 2


def test_deleting_a_bill_removes_only_its_rows(api, units):
    main, _ = units
    manual = UtilityReading.objects.create(
        rental_unit=main, kind="electricity", period=date(2026, 1, 1), usage=5
    )
    bill = api.post(URL, body(units), format="json").json()
    assert api.delete(f"{URL}{bill['id']}/").status_code == 204
    assert list(UtilityReading.objects.all()) == [manual]
    assert not MunicipalCharge.objects.exists()


def test_a_reading_entered_by_hand_blocks_the_bill_rather_than_being_overwritten(api, units):
    main, _ = units
    manual = UtilityReading.objects.create(
        rental_unit=main, kind="water", period=date(2026, 10, 1), usage=5
    )
    res = api.post(URL, body(units), format="json")
    assert res.status_code == 400
    assert "already has water logged" in res.json()["detail"]
    # The failed save rolls back whole: no half-written bill.
    assert not Bill.objects.exists()
    manual.refresh_from_db()
    assert manual.usage == 5


def test_rows_from_a_bill_can_only_be_changed_on_the_bill(api, units):
    api.post(URL, body(units), format="json")
    reading = UtilityReading.objects.get(kind="water")
    charge = MunicipalCharge.objects.get()
    assert api.patch(f"/api/readings/{reading.id}/", {"usage": "1"}).status_code == 400
    assert api.delete(f"/api/readings/{reading.id}/").status_code == 400
    assert api.delete(f"/api/charges/{charge.id}/").status_code == 400


def test_one_bill_per_account_and_month(api, units):
    assert api.post(URL, body(units), format="json").status_code == 201
    res = api.post(URL, body(units, period="2026-10-02"), format="json")
    assert res.status_code == 400
    assert "already a bill" in str(res.json())


def test_usage_is_rejected_on_services_without_a_meter(api, units):
    payload = body(units)
    payload["units"][0]["lines"] = [line("rates", "10", usage="4")]
    assert api.post(URL, payload, format="json").status_code == 400


def test_the_list_leaves_out_lines_and_raw_content(api, units):
    api.post(URL, body(units), format="json")
    api.post(URL, body(units, period="2026-03-01"), format="json")
    rows = api.get(URL, {"date_from": "2026-10-15"}).json()
    assert [row["period"] for row in rows] == ["2026-10-01"]
    assert "raw_text" not in rows[0]
    assert "lines" not in rows[0]["units"][0]
    assert rows[0]["services"]["Property rates"]["total"] == pytest.approx(900)


def test_the_unit_filter_shows_only_that_units_share(api, units):
    main, flat = units
    api.post(URL, body(units), format="json")
    only_main = {**body(units, period="2026-03-01"), "units": body(units)["units"][:1]}
    api.post(URL, only_main, format="json")
    rows = api.get(URL, {"unit": flat.id}).json()
    assert [row["period"] for row in rows] == ["2026-10-01"]
    assert rows[0]["total"] == pytest.approx(21.98)
    assert list(rows[0]["services"]) == ["Electricity"]
    # The filter narrows the money, not the record of who shares the bill.
    assert len(rows[0]["units"]) == 2


def test_attachment_round_trip(api, units):
    bill = api.post(URL, body(units), format="json").json()
    url = f"{URL}{bill['id']}/attachment/"
    assert api.get(url).status_code == 404

    upload = SimpleUploadedFile("bill.PDF", b"%PDF-1", content_type="text/html")
    assert api.post(url, {"file": upload}, format="multipart").status_code == 204

    detail = api.get(f"{URL}{bill['id']}/").json()
    assert detail["attachment"] == {
        "filename": "bill.PDF",
        "content_type": "application/pdf",
        "size": 6,
    }
    res = api.get(url)
    assert res.content == b"%PDF-1"
    assert res["Content-Type"] == "application/pdf"
    assert res["Content-Disposition"].startswith("attachment")

    assert api.delete(url).status_code == 204
    assert api.get(f"{URL}{bill['id']}/").json()["attachment"] is None


def test_attachment_rejects_other_file_types(api, units):
    bill = api.post(URL, body(units), format="json").json()
    upload = SimpleUploadedFile("run.exe", b"MZ")
    res = api.post(f"{URL}{bill['id']}/attachment/", {"file": upload}, format="multipart")
    assert res.status_code == 400


def custom_definition():
    """A municipality that bills a levy and a stormwater charge, with its own fields."""
    return {
        "bill_fields": [
            {"key": "account_number", "label": "Customer ref", "type": "text", "required": True},
            {"key": "ward", "label": "Ward", "type": "number", "required": True},
        ],
        "sections": [
            {
                "key": "levy",
                "label": "City levy",
                "destination": "levy",
                "fields": [
                    {"key": "vat", "label": "VAT", "type": "money"},
                    {"key": "zone", "label": "Zone", "type": "text", "required": True},
                ],
                "items": [{"label": "Levy", "charge_type": "basic"}],
            },
            {
                "key": "stormwater",
                "label": "Stormwater",
                "destination": "none",
                "fields": [],
                "items": [],
            },
        ],
    }


def custom_template():
    definition = TemplateDefinitionSerializer(data=custom_definition())
    definition.is_valid(raise_exception=True)
    return BillTemplate.objects.update_or_create(
        name="Other city", defaults={"definition": definition.validated_data}
    )[0]


def custom_body(units, **overrides):
    return {
        "template": custom_template().id,
        "period": "2026-10-01",
        "account_number": "A1",
        "extra": {"ward": "3"},
        "units": [
            {
                "rental_unit": units[0].id,
                "lines": [
                    line("levy", "100.00", "15.00", extra={"zone": "B"}),
                    line("stormwater", "50.00"),
                ],
            }
        ],
        **overrides,
    }


def test_the_current_fields_are_the_default_template(api):
    custom_template()
    templates = api.get("/api/bill-templates/").json()
    assert [t["is_default"] for t in templates] == [True, False]
    definition = templates[0]["definition"]
    assert [s["key"] for s in definition["sections"]] == [
        "rates",
        "refuse",
        "sanitation",
        "electricity",
        "water",
        "other",
    ]
    electricity = definition["sections"][3]
    assert {"label": "Amperage", "charge_type": "capacity"} in electricity["items"]


def test_a_bill_on_a_custom_template_keeps_custom_values_and_routes_by_destination(api, units):
    res = api.post(URL, custom_body(units), format="json")
    assert res.status_code == 201, res.json()
    data = res.json()
    assert data["template_name"] == "Other city"
    assert data["extra"] == {"ward": "3"}
    assert data["units"][0]["lines"][0]["extra"] == {"zone": "B"}
    assert data["services"]["Stormwater"]["total"] == pytest.approx(50)
    # The levy lands in its table; stormwater is set to stay on the bill only.
    charge = MunicipalCharge.objects.get()
    assert (charge.category, charge.amount) == ("levy", Decimal("115.00"))


def test_required_custom_fields_are_enforced(api, units):
    assert api.post(URL, custom_body(units, extra={}), format="json").status_code == 400
    payload = custom_body(units)
    payload["units"][0]["lines"][0]["extra"] = {}
    assert api.post(URL, payload, format="json").status_code == 400


def test_custom_values_must_match_their_type(api, units):
    res = api.post(URL, custom_body(units, extra={"ward": "three"}), format="json")
    assert res.status_code == 400
    assert "Ward" in str(res.json())


def test_unknown_custom_values_are_dropped(api, units):
    res = api.post(URL, custom_body(units, extra={"ward": "3", "nope": "x"}), format="json")
    assert res.json()["extra"] == {"ward": "3"}


def test_a_line_must_use_a_section_of_its_template(api, units):
    payload = custom_body(units)
    payload["units"][0]["lines"] = [line("water", "1")]
    assert api.post(URL, payload, format="json").status_code == 400


def test_editing_a_template_leaves_logged_bills_alone(api, units):
    bill = api.post(URL, custom_body(units), format="json").json()
    template = BillTemplate.objects.get(pk=bill["template"])
    changed = custom_definition()
    changed["sections"] = changed["sections"][1:]
    res = api.patch(f"/api/bill-templates/{template.id}/", {"definition": changed}, format="json")
    assert res.status_code == 200, res.json()

    detail = api.get(f"{URL}{bill['id']}/").json()
    assert [s["key"] for s in detail["layout"]["sections"]] == ["levy", "stormwater"]
    res = api.patch(
        f"{URL}{bill['id']}/",
        {
            "units": [
                {"rental_unit": units[0].id, "lines": [line("levy", "1", extra={"zone": "B"})]}
            ]
        },
        format="json",
    )
    assert res.status_code == 200, res.json()


def test_a_bill_cannot_change_template_after_logging(api, units):
    bill = api.post(URL, body(units), format="json").json()
    other = custom_template()
    res = api.patch(f"{URL}{bill['id']}/", {"template": other.id}, format="json")
    assert res.status_code == 200
    assert res.json()["template"] == bill["template"]


def test_deleting_a_template_keeps_its_bills(api, units):
    bill = api.post(URL, custom_body(units), format="json").json()
    assert api.delete(f"/api/bill-templates/{bill['template']}/").status_code == 204
    detail = api.get(f"{URL}{bill['id']}/").json()
    assert detail["template"] is None
    assert detail["template_name"] == "Other city"
    assert detail["units"][0]["lines"][0]["extra"] == {"zone": "B"}


def test_the_default_template_cannot_be_deleted(api):
    default = BillTemplate.objects.get(is_default=True)
    assert api.delete(f"/api/bill-templates/{default.id}/").status_code == 400


def test_making_a_template_default_replaces_the_old_one(api):
    old = BillTemplate.objects.get(is_default=True)
    res = api.post(
        "/api/bill-templates/",
        {"name": "New", "is_default": True, "definition": custom_definition()},
        format="json",
    )
    assert res.status_code == 201, res.json()
    old.refresh_from_db()
    assert not old.is_default


@pytest.mark.parametrize(
    "change",
    [
        lambda d: d["bill_fields"].pop(0),
        lambda d: d["bill_fields"].append(dict(d["bill_fields"][0])),
        lambda d: d["sections"].clear(),
        lambda d: d["sections"].append(dict(d["sections"][0])),
        lambda d: d["sections"][0]["fields"].__setitem__(
            0, {"key": "vat", "label": "V", "type": "text"}
        ),
        lambda d: d["sections"][0].__setitem__("destination", "somewhere"),
    ],
)
def test_broken_template_definitions_are_rejected(api, change):
    definition = custom_definition()
    change(definition)
    res = api.post("/api/bill-templates/", {"name": "Bad", "definition": definition}, format="json")
    assert res.status_code == 400
