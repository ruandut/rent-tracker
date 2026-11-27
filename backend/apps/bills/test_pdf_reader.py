"""Reading bill PDFs into drafts.

The sample is made up, laid out like a George Municipality statement. Never commit a real bill:
it carries a name, an address and an account number.
"""

from copy import deepcopy
from decimal import Decimal

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile

from apps.bills.defaults import GEORGE
from apps.bills.models import BillTemplate, Meter
from apps.bills.pdf_reader import ReadError, allocate, extract_text, read_bill
from apps.ledger.models import RentalUnit
from apps.utilities.models import UtilityReading

URL = "/api/bills/read-pdf/"

STATEMENT = """\
                       Sample Municipality                         Tax Invoice
                       Statement Date                               2026-10-24
                       Tax Invoice Number                   202610/000000001001
                       Account Number                              000000001001
A Tenant
1 Sample Street

   Services            Opening    Receipts   Billed     VAT        Interest   Journals   Closing
                       Balance
Electricity Basic      R 0.00     R 0.00     R 394.78   R 59.22    R 0.00     R 1 068.54 R 1 522.54
Property  Rates        R 0.00     R 0.00     R 1 508.54 R 0.00     R 12.00    R 0.00     R 1 520.54
Water Basic            R 0.00     R 0.00     R 324.18   R 48.62    R 0.00     R 0.00     R 372.80
Water Metered          R 0.00     R 0.00     R 1 397.08 R 209.56   R 0.00     R 0.00     R 1 606.64
Deposit: Water Metered R 0.00     R 0.00     R 0.00     R 0.00     R 0.00     R 4 892.00 R 4 892.00
Total                  R 0.00     R 0.00     R 3 624.58 R 317.40   R 12.00    R 5 960.54 R 9 914.52

  Water Details:                          R 9 597.12     R 317.40     R 9 914.52     2026-11-20

     Type      Meter Number   Previous Reading   New Reading   Consumption   Reading Days
     Water     BX1                4631              4640             9            29
     Water     CA2                1428              1479            51            46

     Type      Previous Reading Date   New Reading Date   Factor   Reading Type
     Water     30/09/2026              29/10/2026         1        Actual
     Water     30/09/2026              15/11/2026         1        Levy Estimate

  Type            Tariff         Meter Number         Meter Connection Size
Pre-Paid         PDOM            11111111111                20 Amps
Pre-Paid         PDOM            22222222222                40 Amps
"""


def _escape(text: str) -> str:
    return text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def bill_pdf(text: str = STATEMENT) -> bytes:
    """A one-page PDF with `text` on it in Courier, one line per row, as a statement prints it."""
    rows = text.splitlines()
    stream = "BT /F1 7 Tf 9 TL 20 820 Td " + " ".join(f"({_escape(row)}) Tj T*" for row in rows)
    stream += " ET"
    objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] "
        "/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>",
        f"<< /Length {len(stream)} >>\nstream\n{stream}\nendstream",
    ]
    out, offsets = b"%PDF-1.4\n", []
    for number, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f"{number} 0 obj\n{body}\nendobj\n".encode("latin-1")
    xref = len(out)
    out += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode()
    out += "".join(f"{offset:010d} 00000 n \n" for offset in offsets).encode()
    trailer = f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n"
    out += trailer.encode()
    return out


def upload(api, data: bytes = None, name="bill.pdf", template=None):
    template = template or BillTemplate.objects.get(is_default=True)
    file = SimpleUploadedFile(name, bill_pdf() if data is None else data)
    return api.post(URL, {"file": file, "template": template.id}, format="multipart")


def failed(draft):
    return [check["label"] for check in draft["checks"] if not check["ok"]]


def test_reads_the_header_and_totals(api):
    res = upload(api)
    assert res.status_code == 200, res.json()
    draft = res.json()
    assert draft["period"] == "2026-10-01"
    assert draft["values"] == {
        "account_number": "000000001001",
        "invoice_number": "202610/000000001001",
        "statement_date": "2026-10-24",
        "due_date": "2026-11-20",
        "opening_balance": "0.00",
        # Billed plus VAT plus interest: the month's charges, without the journals.
        "stated_total": "3953.98",
        "amount_due": "9914.52",
    }
    assert failed(draft) == []
    assert draft["existing_bill"] is None
    assert "Sample Street" in draft["raw_text"]


def test_each_service_lands_in_its_templates_section(api):
    lines = upload(api).json()["units"][0]["lines"]
    assert [(line["section"], line["charge_type"], line["description"]) for line in lines] == [
        ("electricity", "basic", "Electricity Basic"),
        ("rates", "basic", "Property Rates"),
        ("other", "other", "Interest: Property Rates"),
        ("water", "basic", "Water Basic"),
        ("water", "usage", "Water Metered"),
        ("water", "usage", "Meter BX1 (Actual)"),
        ("water", "usage", "Meter CA2 (Levy Estimate)"),
    ]
    metered = lines[4]
    assert (metered["amount_excl"], metered["vat"], metered["usage"]) == ("1397.08", "209.56", None)
    second = lines[6]
    assert second["amount_excl"] == "0.00"
    assert (second["meter_previous"], second["meter_current"], second["usage"]) == (
        "1428",
        "1479",
        "51",
    )
    assert (second["reading_from"], second["reading_to"]) == ("2026-09-30", "2026-11-15")


def test_journals_are_noted_but_not_charged(api):
    notes = upload(api).json()["notes"]
    assert any("Deposit: Water Metered" in note for note in notes)
    assert any("R 5 960.54" in note for note in notes)


def test_a_single_meter_goes_on_the_metered_line():
    text = "\n".join(line for line in STATEMENT.splitlines() if "CA2" not in line)
    text = text.replace("Levy Estimate", "").replace(
        "     Water     30/09/2026              15/11/2026         1\n", ""
    )
    lines = read_bill(text, GEORGE)["units"][0]["lines"]
    metered = next(line for line in lines if line["description"] == "Water Metered")
    assert (metered["meter_number"], metered["usage"]) == ("BX1", "9")
    assert not any(line["description"].startswith("Meter ") for line in lines)


def test_a_misread_number_fails_a_check():
    draft = read_bill(STATEMENT.replace("R 324.18", "R 324.10"), GEORGE)
    assert any("billed column" in label for label in failed(draft))
    assert any("Water Basic" in label for label in failed(draft))


def test_services_without_a_section_are_noted_and_fail_the_total():
    layout = deepcopy(GEORGE)
    layout["sections"] = [s for s in layout["sections"] if s["key"] not in ("rates", "other")]
    draft = read_bill(STATEMENT, layout)
    assert not any(line["description"] == "Property Rates" for line in draft["units"][0]["lines"])
    assert any("no section for Property Rates" in note for note in draft["notes"])
    assert any("some charges have nowhere to go" in label for label in failed(draft))


def test_the_existing_bill_for_that_month_is_pointed_out(api, realm):
    template = BillTemplate.objects.get(is_default=True)
    draft = upload(api).json()
    unit = RentalUnit.objects.create(realm=realm, name="Main")
    body = {
        "template": template.id,
        "period": draft["period"],
        "account_number": draft["values"]["account_number"],
        "units": [{"rental_unit": unit.id, "lines": []}],
    }
    bill = api.post("/api/bills/", body, format="json").json()
    assert upload(api).json()["existing_bill"] == bill["id"]


@pytest.mark.parametrize(
    ("data", "name", "message"),
    [
        (b"not a pdf at all", "bill.pdf", "couldn't be read as a PDF"),
        (None, "bill.txt", "extension"),
        (bill_pdf("Dear customer, your bill is attached."), "bill.pdf", "probably a scan"),
        (bill_pdf("Total due    R 10.00"), "bill.pdf", "services table"),
    ],
)
def test_files_that_arent_readable_bills_are_refused(api, data, name, message):
    res = upload(api, data, name)
    assert res.status_code == 400
    assert message in res.json()["file"][0]


def test_scanned_pdfs_raise_read_error():
    with pytest.raises(ReadError):
        extract_text(bill_pdf("No amounts here"))


def test_a_draft_saves_as_is_and_feeds_the_readings(api, realm):
    template = BillTemplate.objects.get(is_default=True)
    draft = upload(api).json()
    unit = RentalUnit.objects.create(realm=realm, name="Main")
    body = {
        "template": template.id,
        "period": draft["period"],
        **draft["values"],
        "units": [{"rental_unit": unit.id, "lines": draft["units"][0]["lines"]}],
    }
    res = api.post("/api/bills/", body, format="json")
    assert res.status_code == 201, res.json()
    assert res.json()["total"] == pytest.approx(float(draft["values"]["stated_total"]))
    water = UtilityReading.objects.get(kind="water", rental_unit=unit)
    # Both meters' usage, and every water charge including the basic one.
    assert (water.usage, water.cost) == (Decimal("60.00"), Decimal("1979.44"))


def test_every_meter_is_listed_with_its_unit_once_linked(api):
    meters = upload(api).json()["meters"]
    assert [(m["kind"], m["number"], m["prepaid"], m["connection"]) for m in meters] == [
        ("water", "BX1", False, ""),
        ("water", "CA2", False, ""),
        ("electricity", "11111111111", True, "20 Amps"),
        ("electricity", "22222222222", True, "40 Amps"),
    ]
    assert {m["rental_unit"] for m in meters} == {None}


@pytest.fixture
def linked(realm):
    """The house has BX1 and the 20 A meter; the flat has CA2 and the 40 A one."""
    house = RentalUnit.objects.create(realm=realm, name="House")
    flat = RentalUnit.objects.create(realm=realm, name="Flat")
    for number, kind, unit in [
        ("BX1", "water", house),
        ("CA2", "water", flat),
        ("11111111111", "electricity", house),
        ("22222222222", "electricity", flat),
    ]:
        Meter.objects.create(realm=realm, number=number, kind=kind, rental_unit=unit)
    return house, flat


def _amounts(unit):
    return {
        line["description"]: (line["amount_excl"], line["vat"], line["meter_number"], line["usage"])
        for line in unit["lines"]
    }


def test_linked_meters_split_the_bill_between_their_units(api, linked):
    house, flat = linked
    draft = upload(api).json()
    assert [unit["rental_unit"] for unit in draft["units"]] == [house.id, flat.id]
    assert _amounts(draft["units"][0]) == {
        # One fixed fee per meter, naming the meter it's for.
        "Electricity Basic": ("197.39", "29.61", "11111111111", None),
        # Property charges evenly, the odd cent going to the first unit.
        "Property Rates": ("754.27", "0.00", "", None),
        "Interest: Property Rates": ("6.00", "0.00", "", None),
        "Water Basic": ("162.09", "24.31", "BX1", None),
        # The metered charge by usage, 9 of 60 kL, with that meter's readings.
        "Water Metered": ("209.56", "31.43", "BX1", "9"),
    }
    assert _amounts(draft["units"][1])["Water Metered"] == ("1187.52", "178.13", "CA2", "51")
    assert [c["label"] for c in draft["checks"] if not c["ok"]] == []
    assert {m["rental_unit"] for m in draft["meters"]} == {house.id, flat.id}


def test_a_split_draft_saves_and_feeds_each_units_readings(api, linked):
    house, flat = linked
    draft = upload(api).json()
    body = {
        "template": BillTemplate.objects.get(is_default=True).id,
        "period": draft["period"],
        **draft["values"],
        "units": draft["units"],
    }
    res = api.post("/api/bills/", body, format="json")
    assert res.status_code == 201, res.json()
    assert res.json()["total"] == pytest.approx(float(draft["values"]["stated_total"]))
    usage = {
        reading.rental_unit: reading.usage
        for reading in UtilityReading.objects.filter(kind="water")
    }
    assert usage == {house: Decimal("9.00"), flat: Decimal("51.00")}


def test_until_every_meter_is_linked_it_stays_one_unit(api, linked):
    Meter.objects.get(number="CA2").delete()
    draft = upload(api).json()
    assert [unit["rental_unit"] for unit in draft["units"]] == [None]


def test_two_meters_of_a_kind_on_one_unit_keep_lines_of_their_own(api, linked):
    house, _flat = linked
    Meter.objects.filter(number="CA2").update(rental_unit=house)
    draft = upload(api).json()
    house_lines = _amounts(draft["units"][0])
    assert house_lines["Water Basic"][:2] == ("324.18", "48.62")
    assert house_lines["Meter CA2 (Levy Estimate)"] == ("0.00", "0.00", "CA2", "51")


@pytest.mark.parametrize(
    ("amount", "weights", "shares"),
    [
        ("1508.54", [1, 1], ["754.27", "754.27"]),
        ("103.11", [1, 1], ["51.56", "51.55"]),
        ("-0.05", [1, 1, 1], ["-0.02", "-0.02", "-0.01"]),
        ("1397.08", [9, 51], ["209.56", "1187.52"]),
    ],
)
def test_shares_add_up_to_the_cent(amount, weights, shares):
    split = allocate(Decimal(amount), [Decimal(w) for w in weights])
    assert [str(share) for share in split] == shares
    assert sum(split) == Decimal(amount)
