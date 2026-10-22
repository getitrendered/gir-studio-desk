"""Read the historical cash workbook without changing it."""
import datetime as dt
import hashlib
import json
import pathlib
import sys

import openpyxl


path = pathlib.Path(sys.argv[1])
book = openpyxl.load_workbook(path, read_only=True, data_only=True)
sheet = book["Revenue"]
assert tuple(next(sheet.values)) == ("MONTH", "SR.NO", "CLIENT", "AMOUNT RECEIVED", "DATE")
payments = []
for row_number, (month_label, serial, client, amount, raw_date) in enumerate(sheet.values, 1):
    if row_number == 1:
        continue
    if not isinstance(raw_date, (dt.date, dt.datetime)) or not isinstance(amount, (int, float)):
        raise ValueError(f"Invalid payment on row {row_number}")
    month = dt.datetime.strptime(month_label.strip(), "%B %Y").date()
    original = raw_date.date() if isinstance(raw_date, dt.datetime) else raw_date
    received = original
    quality = "exact"
    if (original.year, original.month) != (month.year, month.month):
        try:
            swapped = dt.date(original.year, original.day, original.month)
        except ValueError:
            swapped = None
        if swapped and (swapped.year, swapped.month) == (month.year, month.month):
            received = swapped
            quality = "day_month_swapped"
        else:
            received = None
            quality = "month_only"
    payments.append({
        "row": row_number, "month": month.isoformat(), "client": client.strip(),
        "amount": round(float(amount), 2), "received_on": received.isoformat() if received else None,
        "original_date": original.isoformat(), "date_quality": quality,
    })
print(json.dumps({"file": path.name, "sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "payments": payments}))
