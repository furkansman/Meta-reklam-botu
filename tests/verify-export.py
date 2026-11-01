"""Run after node tests/export.test.cjs; requires openpyxl."""
from pathlib import Path
import csv
import json
import zipfile
import openpyxl
root = Path(__file__).resolve().parent.parent
columns = ['Reklam ID','Reklam Veren','Hook','Başlık (Headline)','Yayın Başlangıç','Yaş (gün)','Durum','Medya Türü','Medya URL','CTA','Hedef URL']
with (root / 'examples/ornek-hook-cikti.csv').open(encoding='utf-8-sig', newline='') as stream:
    rows = list(csv.reader(stream))
assert rows[0] == columns + ['Tam Metin'] and len(rows) == 5
assert all(len(row) == 12 for row in rows)
assert rows[1][0] == '1234567890123456' and '\n' in rows[1][-1]
assert [int(row[5]) for row in rows[1:]] == sorted([int(row[5]) for row in rows[1:]], reverse=True)
records = json.loads((root / 'examples/ornek-hook-cikti.json').read_text())
assert list(records[0]) == columns + ['Tam Metin']
file = root / 'examples/reklam-analizi-hook-ornek.xlsx'
with zipfile.ZipFile(file) as archive:
    assert archive.testzip() is None
workbook = openpyxl.load_workbook(file)
assert workbook.sheetnames == ['Reklamlar','Özet']
sheet = workbook['Reklamlar']
assert [cell.value for cell in sheet[1]] == columns
assert sheet.max_column == 11 and sheet.freeze_panes == 'C2'
assert sheet.auto_filter.ref == 'A1:K5'
assert sheet['A1'].font.bold and sheet['A1'].font.color.rgb == 'FFFFFFFF'
assert sheet['A1'].fill.fgColor.rgb == 'FF163A70'
assert sheet['A2'].value == '1234567890123456' and sheet['A2'].data_type == 's' and sheet['A2'].number_format == '@'
assert sheet['C2'].alignment.wrap_text
assert sheet.column_dimensions['C'].width >= 50
assert [sheet.cell(row,7).fill.fgColor.rgb for row in range(2,6)] == ['FFE2EFDA','FFE7E6E6','FFD9EAF7','FFFFF2CC']
summary = workbook['Özet']
assert summary['B1'].value == 'Örnek arama' and summary['B2'].value == 4
values = [cell.value for row in summary for cell in row]
for title in ['Durum grupları','Medya türü dağılımı','Reklam verenler','En çok kullanılan 8 CTA','Tekrar eden hook kalıpları']:
    assert title in values
print('PASS: ordered 12-column CSV/JSON; 11-column sorted XLSX, 2 sheets, C2 freeze, header/status colors, string ID, wrapped Hook and five summary tables.')
