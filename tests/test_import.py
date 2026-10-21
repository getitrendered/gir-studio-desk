"""Synthetic workbook that exercises spacer columns and yellow deal grouping."""
from pathlib import Path
from subprocess import run
from tempfile import TemporaryDirectory
from zipfile import ZipFile


def main():
    root = Path(__file__).resolve().parents[1]
    with TemporaryDirectory(dir=root / "tests") as folder:
        book = Path(folder) / "sample.xlsx"
        with ZipFile(book, "w") as z:
            z.writestr("xl/workbook.xml", '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Surbhi" sheetId="1" r:id="rId1"/></sheets></workbook>')
            z.writestr("xl/_rels/workbook.xml.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"/></Relationships>')
            z.writestr("xl/styles.xml", '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFD966"/></patternFill></fill></fills><cellXfs count="2"><xf fillId="0"/><xf fillId="1"/></cellXfs></styleSheet>')
            z.writestr("xl/sharedStrings.xml", '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>SERVICE PROVIDED</t></si><si><t>PHOTOBOOTH 3D</t></si></sst>')
            def cell(ref, value, yellow=False):
                return f'<c r="{ref}" t="inlineStr" s="{int(yellow)}"><is><t>{value}</t></is></c>'
            heads = [("A", "SR NO"), ("B", "DATE"), ("C", "SERVICE PROVIDED"), ("D", "QUANTITY"), ("F", "RATE"), ("G", "TOTAL"), ("H", "STATUS"), ("J", "REMARKS"), ("L", "ADVANCE TAKEN")]
            header = "".join(cell(f"{col}2", title) for col, title in heads)
            def row(number, service, yellow):
                values = [("A", number-2),("B", "10/9/2024"),("C", service),("D",1),("F",3000),("G",3000),("H","-" if number == 5 else "" if number == 4 else "SENT"),("J",""),("L",500 if number == 3 else "")]
                return f'<row r="{number}">' + "".join(cell(f"{col}{number}", value, yellow) for col,value in values) + '</row>'
            xml = '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="2">' + header + '</row>' + row(3, "PHOTOBOOTH 3D", True) + row(4, "HALLOWEEN 3D", True) + row(5, "CHRISTMAS 3D", False) + '</sheetData></worksheet>'
            xml = xml.replace(cell("C2", "SERVICE PROVIDED"), '<c r="C2" t="s"><v>0</v></c>').replace(cell("C3", "PHOTOBOOTH 3D", True), '<c r="C3" t="s" s="1"><v>1</v></c>')
            xml = xml.replace('</row><row r="4">', cell('K3', 'closed at') + '</row><row r="4">')
            xml = xml.replace('</row><row r="5">', '<c r="K4"><v>5000</v></c></row><row r="5">')
            z.writestr("xl/worksheets/sheet1.xml", xml)
        command = f"[cultureinfo]::CurrentCulture = 'en-US'; & '{root / 'import-xlsx.ps1'}' -Path '{book}'"
        result = run(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command], capture_output=True, text=True)
        assert result.returncode == 0, result.stderr
        import json
        parsed = json.loads(result.stdout)
        rows = parsed["clients"][0]["items"]
        assert len(rows) == 3, parsed
        assert rows[0]["yellowGroup"] == rows[1]["yellowGroup"] == 1, parsed
        assert rows[2]["yellowGroup"] is None, parsed
        assert rows[0]["date"] == "2024-09-10", parsed
        assert rows[0]["service"] == "PHOTOBOOTH 3D", parsed
        assert rows[0]["advance"] == "500" and rows[0]["advanceCell"] == "L3", parsed
        assert rows[1]["status"] == "pending", parsed
        assert rows[2]["status"] == "discarded", parsed
        group = parsed["clients"][0]["groups"][0]
        assert group["startRow"] == 3 and group["endRow"] == 4, parsed
        assert group["agreedAmount"] == 5000 and group["amountCell"] == "K4", parsed
        unlabeled_book = Path(folder) / "unlabeled.xlsx"
        with ZipFile(book) as original, ZipFile(unlabeled_book, "w") as altered:
            for entry in original.infolist():
                content = original.read(entry.filename)
                if entry.filename == "xl/worksheets/sheet1.xml":
                    content = content.replace(cell("K3", "closed at").encode(), b"")
                altered.writestr(entry, content)
        unlabeled_command = f"[cultureinfo]::CurrentCulture = 'en-US'; & '{root / 'import-xlsx.ps1'}' -Path '{unlabeled_book}'"
        unlabeled = run(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", unlabeled_command], capture_output=True, text=True)
        assert unlabeled.returncode == 0, unlabeled.stderr
        unlabeled_result = json.loads(unlabeled.stdout)
        unlabeled_group = unlabeled_result["clients"][0]["groups"][0]
        assert unlabeled_group["agreedAmount"] == 5000 and unlabeled_group["amountCell"] == "K4", unlabeled_result
        print("Import fixture passed")


if __name__ == "__main__":
    main()
