"""Shared loader for the intake template generator and its artifacts."""
import csv
import importlib.util
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
TEMPLATE_XLSX = REPO_ROOT / "templates" / "customer-intake.xlsx"
TEMPLATE_CSV_DIR = REPO_ROOT / "templates" / "customer-intake"
TEMPLATE_README = TEMPLATE_CSV_DIR / "README.md"

# xlsx sheet titles (31-char safe) in order — 7 customer-facing + internal field map.
EXPECTED_SHEET_TITLES = [
    "01 公司概况",
    "02 产品线与出口",
    "03 目标行业与区域",
    "04 竞争对手清单",
    "05 监控关键词与采购信号",
    "06 ICP与潜客评分",
    "07 交付与审批偏好",
    "08 字段映射(内部)",
]

CUSTOMER_SHEET_CSVS = [
    "01-company-profile.csv",
    "02-product-lines-export.csv",
    "03-target-industries-regions.csv",
    "04-competitor-list.csv",
    "05-keywords-intent-signals.csv",
    "06-icp-lead-criteria.csv",
    "07-delivery-approvals.csv",
]


def load_generator():
    """Import tools/intake/generate.py as a module (repo has no package layout yet)."""
    spec = importlib.util.spec_from_file_location("intake_generate", REPO_ROOT / "tools" / "intake" / "generate.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def read_csv_rows(path):
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.reader(f))


def xlsx_sheets():
    """{sheet_title: [[cell, ...], ...]} including the header row."""
    import openpyxl

    wb = openpyxl.load_workbook(TEMPLATE_XLSX, read_only=True, data_only=True)
    try:
        return {title: [[("" if c is None else str(c)) for c in row] for row in ws.iter_rows(values_only=True)]
                for title, ws in ((s, wb[s]) for s in wb.sheetnames)}
    finally:
        wb.close()


def parse_field_map(rows):
    """Compiler fixture: field-map rows → {intake_key: {sheet, source, required, config_keys, agent}}.

    `rows` is a list of [序号, intake key, sheet, source row, required, config keys, agent, note].
    """
    fixture = {}
    for row in rows:
        key = row[1].strip()
        assert key, "field-map row without an intake key"
        entry = {
            "sheet": row[2].strip(),
            "source": row[3].strip(),
            "required": row[4].strip(),
            "config_keys": [k.strip() for k in row[5].split(";") if k.strip()],
            "agent": row[6].strip(),
        }
        assert key not in fixture, f"duplicate intake key in field map: {key}"
        fixture[key] = entry
    return fixture
