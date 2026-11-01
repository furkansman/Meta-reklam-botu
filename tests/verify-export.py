"""Run after node tests/export.test.cjs; requires openpyxl."""
from pathlib import Path
import csv
import zipfile
import openpyxl
root = Path(__file__).resolve().parent.parent
expected = ['Reklam ID', 'Reklam Veren', 'Metin (Primary Text)', 'Başlık (Headline)', 'Yayın Başlangıç', 'Yaş (gün)', 'Medya Türü', 'Medya URL', 'CTA', 'Hedef URL', 'Platformlar', 'Reklam Linki']
with (root / 'examples/reklamlar-ornek.csv').open(encoding='utf-8-sig', newline='') as stream:
    rows = list(csv.reader(stream))
assert rows[0] == expected and len(rows) == 2 and len(rows[1]) == 12
assert rows[1][0] == '1234567890123456' and '\n' in rows[1][2]
with zipfile.ZipFile('/tmp/meta-export-test.xlsx') as archive:
    assert archive.testzip() is None
workbook = openpyxl.load_workbook('/tmp/meta-export-test.xlsx')
assert workbook.sheetnames == ['Reklamlar']
sheet = workbook['Reklamlar']
assert [cell.value for cell in sheet[1]] == expected
assert sheet.freeze_panes == 'A2' and sheet['A1'].font.bold
assert sheet['A2'].value == '1234567890123456' and sheet['A2'].data_type == 's' and sheet['A2'].number_format == '@'
assert sheet['C2'].alignment.wrap_text and sheet['C2'].value == 'İlk satır\nİkinci satır'
assert sheet.column_dimensions['C'].width >= 50
print('PASS: exact CSV schema; XLSX CRC, text ID, bold/frozen header, wrapped primary text and readable widths.')
