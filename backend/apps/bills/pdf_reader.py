"""Reads a municipal bill PDF into a draft bill, for the editor to fill in and someone to check.

Written against George Municipality's statement PDFs, which carry a text layer, so the numbers
are read exactly rather than guessed: nothing here is a model or OCR. Each service row becomes a
line in the template section whose destination matches it, and every sum the bill prints is
checked against the numbers read, so a layout change shows up as a failed check, not a quietly
wrong bill. Nothing is saved: the result goes back to the form.
"""

import io
import re
from datetime import date, datetime
from decimal import Decimal

from pypdf import PdfReader
from pypdf.errors import PdfReadError

ZERO = Decimal("0.00")
CENT = Decimal("0.01")

# "R 1 068.54", "-R 130.80", "R -1.00" or "(R 144.33)": thousands are split by single spaces,
# while columns are split by several, so one match never runs into the next column.
AMOUNT = r"\(?-?R\s?-?\d{1,3}(?: \d{3})*\.\d{2}\)?"
ISO_DATE = r"\d{4}-\d{2}-\d{2}"
SLASH_DATE = r"\d{2}/\d{2}/\d{4}"

# The services table's columns, in the order printed.
COLUMNS = ["opening", "receipts", "billed", "vat", "interest", "journals", "closing"]

# Words in a service's name -> the destination of the template section it belongs in.
DESTINATIONS = [
    ("electric", "electricity"),
    ("water", "water"),
    ("rate", "rates_taxes"),
    ("sanitation", "sewerage"),
    ("sewer", "sewerage"),
    ("waste", "refuse"),
    ("refuse", "refuse"),
    ("levy", "levy"),
    ("insurance", "insurance"),
]
# Meter types -> destination. Prepaid electricity meters have no readings on the bill.
METER_TYPES = {"water": "water", "electricity": "electricity"}


class ReadError(Exception):
    """The file can't be read as a bill. The message is for the person uploading it."""


def money(text: str) -> Decimal:
    negative = text.startswith("(") or "-" in text
    value = Decimal(re.sub(r"[^\d.]", "", text))
    return -value if negative else value


def amounts(line: str) -> list[Decimal]:
    return [money(found) for found in re.findall(AMOUNT, line)]


def _slash_date(text: str) -> str:
    return datetime.strptime(text, "%d/%m/%Y").date().isoformat()


def extract_text(data: bytes) -> str:
    """The PDF's text, laid out as printed, with trailing space and blank runs trimmed."""
    try:
        reader = PdfReader(io.BytesIO(data))
        if reader.is_encrypted:
            raise ReadError("This PDF is password protected. Save an unprotected copy first.")
        pages = [page.extract_text(extraction_mode="layout") for page in reader.pages]
    except (PdfReadError, ValueError, KeyError) as exc:
        raise ReadError("This file couldn't be read as a PDF.") from exc
    lines = [line.rstrip() for page in pages for line in page.splitlines()]
    text = re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()
    if not re.search(AMOUNT, text):
        raise ReadError(
            "This PDF has no readable text, so it's probably a scan. Log it by hand instead."
        )
    return text


def _header(text: str, label: str, pattern: str) -> str:
    found = re.search(rf"{label}\s+({pattern})", text)
    return found.group(1) if found else ""


def _services(text: str) -> tuple[list[dict], dict | None]:
    """The rows of the services table, and its Total row."""
    rows, total, inside = [], None, False
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("Services") and "Closing" in stripped:
            inside = True
            continue
        if not inside:
            continue
        found = amounts(line)
        if len(found) != len(COLUMNS):
            continue
        name = re.sub(r"\s+", " ", line[: line.index(re.search(AMOUNT, line).group(0))]).strip()
        row = {"name": name, **dict(zip(COLUMNS, found, strict=True))}
        if name.lower() == "total":
            total = row
            break
        rows.append(row)
    return rows, total


def _due(text: str) -> tuple[list[Decimal], str]:
    """Amount excl VAT, VAT and total due, and the due date, from the line that ends in it."""
    for line in text.splitlines():
        found = re.search(rf"((?:{AMOUNT}\s+){{3}})({ISO_DATE})\s*$", line)
        if found:
            return amounts(found.group(1)), found.group(2)
    return [], ""


def _meters(text: str) -> list[dict]:
    """Every meter on the bill: metered ones with their readings, then prepaid ones.

    Readings are one table of numbers, then one of dates, in the same order. Prepaid meters
    have a table of their own, with a tariff and connection size but no readings.
    """
    types = "|".join(name.capitalize() for name in METER_TYPES)
    number = r"-?\d+(?:\.\d+)?"
    readings = re.findall(
        rf"^\s*({types})\s+(\S+)\s+({number})\s+({number})\s+({number})\s+(\d+)\s*$",
        text,
        re.MULTILINE,
    )
    dates = re.findall(
        rf"^\s*({types})\s+({SLASH_DATE})\s+({SLASH_DATE})\s+\S+\s+(.+?)\s*$",
        text,
        re.MULTILINE,
    )
    meters = []
    for index, (kind, meter, previous, current, used, _days) in enumerate(readings):
        when = dates[index] if index < len(dates) and dates[index][0] == kind else None
        meters.append(
            {
                "kind": METER_TYPES[kind.lower()],
                "number": meter,
                "prepaid": False,
                "tariff": "",
                "connection": "",
                "meter_previous": Decimal(previous),
                "meter_current": Decimal(current),
                "usage": Decimal(used),
                "reading_from": _slash_date(when[1]) if when else None,
                "reading_to": _slash_date(when[2]) if when else None,
                "reading_type": when[3] if when else "",
            }
        )
    for tariff, meter, connection in re.findall(
        r"^\s*Pre-?Paid\s+(\S+)\s+(\d+)\s+(\d+\s*Amps?)\s*$", text, re.MULTILINE | re.IGNORECASE
    ):
        meters.append(
            {
                "kind": "electricity",
                "number": meter,
                "prepaid": True,
                "tariff": tariff,
                "connection": re.sub(r"\s+", " ", connection),
                "meter_previous": None,
                "meter_current": None,
                "usage": None,
                "reading_from": None,
                "reading_to": None,
                "reading_type": "",
            }
        )
    return meters


def _destination(name: str) -> str:
    lowered = name.lower()
    return next((dest for word, dest in DESTINATIONS if word in lowered), "other")


def _charge_type(name: str, destination: str) -> str:
    lowered = name.lower()
    if any(word in lowered for word in ("metered", "consumption", "usage")):
        return "usage"
    if any(word in lowered for word in ("basic", "fixed")):
        return "basic"
    if "rebate" in lowered:
        return "rebate"
    if destination in ("rates_taxes", "refuse", "sewerage", "levy", "insurance"):
        return "basic"
    return "other"


def _line(section, charge_type, description, excl, vat, meter=None) -> dict:
    line = {
        "section": section,
        "charge_type": charge_type,
        "description": description,
        "amount_excl": str(excl),
        "vat": str(vat),
        "meter_number": "",
        "meter_previous": None,
        "meter_current": None,
        "reading_from": None,
        "reading_to": None,
        "usage": None,
    }
    if meter:
        line["meter_number"] = meter["number"]
    if meter and meter["usage"] is not None:
        line.update(
            meter_previous=str(meter["meter_previous"]),
            meter_current=str(meter["meter_current"]),
            reading_from=meter["reading_from"],
            reading_to=meter["reading_to"],
            usage=str(meter["usage"]),
        )
    return line


def allocate(amount: Decimal, weights: list[Decimal]) -> list[Decimal]:
    """`amount` split in proportion to `weights`, to the cent, with the shares adding up exactly."""
    cents = int(abs(amount) * 100)
    total = sum(weights)
    exact = [cents * weight / total for weight in weights]
    shares = [int(share) for share in exact]
    by_remainder = sorted(range(len(exact)), key=lambda i: exact[i] - shares[i], reverse=True)
    for index in by_remainder[: cents - sum(shares)]:
        shares[index] += 1
    sign = -1 if amount < 0 else 1
    return [(Decimal(sign * share) / 100).quantize(CENT) for share in shares]


def lay_out(charges: list[dict], meters: list[dict], owners: dict) -> list[dict]:
    """The bill's lines, per rental unit: [{"rental_unit": id or None, "lines": [...]}].

    `owners` maps meter numbers to rental units. Until every meter on the bill has one, it's
    one unit (None) with every line, for the person to split. Once they do, water and
    electricity fees are split equally per meter, the metered charge by each meter's usage,
    and everything else (rates, refuse, sanitation) evenly between the units on the bill.

    A meter's readings go on its unit's usage line when it's that unit's only meter of its
    kind; otherwise each meter gets a line of its own carrying its readings but no money.
    """
    owner = (
        (lambda meter: owners[meter["number"]])
        if meters and all(meter["number"] in owners for meter in meters)
        else (lambda meter: None)
    )
    units = list(dict.fromkeys(owner(meter) for meter in meters)) or [None]
    lines = {unit: [] for unit in units}
    placed = set()

    for charge in charges:
        own = [meter for meter in meters if meter["kind"] == charge["destination"]]
        if not own:
            weights = dict.fromkeys(units, Decimal(1))
        else:
            weights = dict.fromkeys(units, Decimal(0))
            by_usage = charge["charge_type"] == "usage" and all(m["usage"] for m in own)
            for meter in own:
                weights[owner(meter)] += meter["usage"] if by_usage else Decimal(1)
        sharing = [unit for unit in units if weights[unit]]
        excls = allocate(charge["excl"], [weights[unit] for unit in sharing])
        vats = allocate(charge["vat"], [weights[unit] for unit in sharing])
        for unit, excl, vat in zip(sharing, excls, vats, strict=True):
            mine = [meter for meter in own if owner(meter) == unit]
            meter = mine[0] if len(mine) == 1 else None
            # Readings belong on the usage line; a fee line only names its meter.
            if meter and meter["usage"] is not None:
                if charge["charge_type"] != "usage" or meter["number"] in placed:
                    meter = {**meter, "usage": None}
                else:
                    placed.add(meter["number"])
            lines[unit].append(
                _line(
                    charge["section"],
                    charge["charge_type"],
                    charge["description"],
                    excl,
                    vat,
                    meter,
                )
            )

    for meter in meters:
        if meter["usage"] is None or meter["number"] in placed or not charges:
            continue
        section = next((c["section"] for c in charges if c["destination"] == meter["kind"]), None)
        if section is None:
            continue
        description = f"Meter {meter['number']}"
        if meter["reading_type"]:
            description += f" ({meter['reading_type']})"
        own_lines = lines[owner(meter)]
        # After the section's other lines, so the editor shows them together.
        at = max(
            (i + 1 for i, line in enumerate(own_lines) if line["section"] == section),
            default=len(own_lines),
        )
        own_lines.insert(at, _line(section, "usage", description, ZERO, ZERO, meter))
    return [{"rental_unit": unit, "lines": unit_lines} for unit, unit_lines in lines.items()]


def _rand(value: Decimal) -> str:
    whole, cents = f"{abs(value):.2f}".split(".")
    grouped = f"{int(whole):,}".replace(",", " ")
    return f"{'-' if value < 0 else ''}R {grouped}.{cents}"


def read_bill(text: str, layout: dict, owners: dict | None = None) -> dict:
    """The draft bill in `text`, laid out on `layout` (a template definition).

    `owners` maps meter numbers to rental unit ids; see lay_out for how it splits the lines.
    """
    rows, total = _services(text)
    if not rows or total is None:
        raise ReadError(
            "Couldn't find the services table in this PDF. Only George Municipality "
            "statements can be read so far."
        )

    sections = {}
    for section in layout["sections"]:
        sections.setdefault(section["destination"], section)
    fallback = sections.get("other")
    meters = _meters(text)
    charges, notes, checks = [], [], []

    def section_for(destination: str) -> dict | None:
        return sections.get(destination, fallback)

    for row in rows:
        destination = _destination(row["name"])
        section = section_for(destination)
        charge_type = _charge_type(row["name"], destination)
        if row["billed"] == ZERO and row["vat"] == ZERO:
            if row["journals"] or row["closing"]:
                notes.append(
                    f"{row['name']} has no charge this month, only a journal of "
                    f"{_rand(row['journals'])}, so it isn't a line."
                )
        elif section is None:
            notes.append(
                f"The template has no section for {row['name']} ({_rand(row['billed'])} plus "
                f"{_rand(row['vat'])} VAT), so it was left out. Add an Other section to keep it."
            )
        else:
            charges.append(
                {
                    "section": section["key"],
                    # The section's, so a service filed under Other isn't split per meter.
                    "destination": section["destination"],
                    "charge_type": charge_type,
                    "description": row["name"],
                    "excl": row["billed"],
                    "vat": row["vat"],
                }
            )
        if row["interest"]:
            target = section_for("other") or section
            if target:
                charges.append(
                    {
                        "section": target["key"],
                        "destination": target["destination"],
                        "charge_type": "other",
                        "description": f"Interest: {row['name']}",
                        "excl": row["interest"],
                        "vat": ZERO,
                    }
                )

    if total["journals"]:
        notes.append(
            f"Journals of {_rand(total['journals'])} moved onto this account. They're part of "
            "the amount due but not charges for the month."
        )

    sums = {column: sum((row[column] for row in rows), ZERO) for column in COLUMNS}
    wrong = [column for column in COLUMNS if sums[column] != total[column]]
    checks.extend(
        {
            "ok": False,
            "label": f"The {column} column adds up to {_rand(sums[column])}, but the bill's "
            f"total is {_rand(total[column])}.",
        }
        for column in wrong
    )
    if not wrong:
        checks.append({"ok": True, "label": f"{len(rows)} services add up to the bill's totals"})

    off = [
        row["name"]
        for row in [*rows, total]
        if row["opening"]
        - abs(row["receipts"])
        + row["billed"]
        + row["vat"]
        + row["interest"]
        + row["journals"]
        != row["closing"]
    ]
    checks.append(
        {
            "ok": not off,
            "label": "Every closing balance is its opening balance plus the month's movements"
            if not off
            else f"Closing balance doesn't follow from the movements on: {', '.join(off)}",
        }
    )

    due, due_date = _due(text)
    amount_due = total["closing"]
    if len(due) == 3:
        excl, vat, incl = due
        checks.append(
            {
                "ok": excl + vat == incl and incl == total["closing"],
                "label": f"Amount due {_rand(incl)} matches the services table"
                if incl == total["closing"]
                else f"Amount due {_rand(incl)} differs from the services table's "
                f"{_rand(total['closing'])}",
            }
        )
        amount_due = incl
    else:
        checks.append({"ok": False, "label": "Couldn't find the amount due and due date."})

    every_meter = [meter for meter in meters if meter["usage"] is not None]
    misread = [
        meter
        for meter in every_meter
        if meter["meter_current"] - meter["meter_previous"] != meter["usage"]
    ]
    checks.extend(
        {
            "ok": False,
            "label": f"Meter {meter['number']}: {meter['meter_current']} minus "
            f"{meter['meter_previous']} isn't the {meter['usage']} printed.",
        }
        for meter in misread
    )
    if every_meter and not misread:
        count = len(every_meter)
        match = "reading matches its" if count == 1 else "readings match their"
        checks.append({"ok": True, "label": f"{count} meter {match} usage"})

    statement_date = _header(text, "Statement Date", ISO_DATE)
    period = date.fromisoformat(statement_date).replace(day=1) if statement_date else None
    stated_total = total["billed"] + total["vat"] + total["interest"]
    owners = owners or {}
    units = lay_out(charges, meters, owners)
    lines = [line for unit in units for line in unit["lines"]]
    lines_total = sum((Decimal(line["amount_excl"]) + Decimal(line["vat"]) for line in lines), ZERO)
    if len(units) > 1:
        notes.append(
            f"Split between {len(units)} units by their meters: fixed water and electricity fees "
            "per meter, the metered water charge by each meter's usage, and the property's "
            "charges evenly."
        )
    checks.append(
        {
            "ok": lines_total == stated_total,
            "label": f"The lines come to the month's {_rand(stated_total)} including VAT"
            if lines_total == stated_total
            else f"The lines come to {_rand(lines_total)}, not the month's "
            f"{_rand(stated_total)}: some charges have nowhere to go.",
        }
    )

    return {
        "period": period.isoformat() if period else None,
        "values": {
            "account_number": _header(text, "Account Number", r"\d+"),
            "invoice_number": _header(text, "Tax Invoice Number", r"\S+"),
            "statement_date": statement_date or None,
            "due_date": due_date or None,
            "opening_balance": str(total["opening"]),
            "stated_total": str(stated_total),
            "amount_due": str(amount_due),
        },
        "units": units,
        "meters": [
            {
                **{
                    key: meter[key] for key in ("kind", "number", "prepaid", "tariff", "connection")
                },
                "usage": None if meter["usage"] is None else str(meter["usage"]),
                "rental_unit": owners.get(meter["number"]),
            }
            for meter in meters
        ],
        "checks": checks,
        "notes": notes,
        "raw_text": text,
    }
