"""Round-trip test: workbook → xlsx → compiler fixture parses with zero field loss.

Verifies that the committed xlsx and the committed per-sheet CSVs carry
identical content, and that the field-map sheet parses into a clean
compiler fixture matching the generator's declared field set.
"""
import hashlib
import subprocess
import sys
import unittest

from tests.intake.helpers import (
    CUSTOMER_SHEET_CSVS,
    EXPECTED_SHEET_TITLES,
    REPO_ROOT,
    TEMPLATE_CSV_DIR,
    TEMPLATE_README,
    load_generator,
    parse_field_map,
    read_csv_rows,
    xlsx_sheets,
)


class TestRoundTrip(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.gen = load_generator()
        cls.sheets = xlsx_sheets()

    def test_xlsx_has_exactly_the_eight_expected_sheets_in_order(self):
        self.assertEqual(list(self.sheets.keys()), EXPECTED_SHEET_TITLES)

    def test_customer_sheet_xlsx_matches_csv_cell_for_cell(self):
        for title, csv_name in zip(EXPECTED_SHEET_TITLES[:7], CUSTOMER_SHEET_CSVS):
            with self.subTest(sheet=title):
                csv_rows = read_csv_rows(TEMPLATE_CSV_DIR / csv_name)
                xlsx_rows = self.sheets[title]
                self.assertEqual(len(xlsx_rows), len(csv_rows), f"row count mismatch in {csv_name}")
                for i, (x_row, c_row) in enumerate(zip(xlsx_rows, csv_rows)):
                    self.assertEqual(x_row, c_row, f"cell mismatch in {csv_name} row {i + 1}")

    def test_readme_documents_filling_instructions(self):
        """Filling instructions ship as README.md (the workbook itself is exactly 8 sheets)."""
        readme = TEMPLATE_README.read_text(encoding="utf-8")
        self.assertIn("填写说明", readme)
        self.assertIn("Confidentiality", readme)
        for row in self.gen.INSTR_ROWS:
            self.assertIn(row[0], readme, f"README missing instruction {row[0]}")
        for title in EXPECTED_SHEET_TITLES:
            self.assertIn(title.split(" ")[0], readme, f"README missing sheet {title}")

    def test_field_map_xlsx_matches_csv(self):
        csv_rows = read_csv_rows(TEMPLATE_CSV_DIR / "08-field-map-internal.csv")
        self.assertEqual(self.sheets[EXPECTED_SHEET_TITLES[7]], csv_rows)

    def test_compiler_fixture_parses_from_xlsx_with_zero_field_loss(self):
        """workbook → xlsx → fixture: parse the field map straight out of the xlsx."""
        header = self.sheets[EXPECTED_SHEET_TITLES[7]][0]
        map_rows = [row for row in self.sheets[EXPECTED_SHEET_TITLES[7]][1:]]
        fixture = parse_field_map(map_rows)

        expected_keys = {f[5] for _s in self.gen.CUSTOMER_SHEETS for f in _s[2]}
        self.assertEqual(len(fixture), len(map_rows), "fixture lost rows while parsing")
        self.assertEqual(set(fixture.keys()), expected_keys, "fixture lost intake fields while parsing")
        self.assertTrue(header, "field-map sheet missing header")

    def test_every_customer_field_has_instructions_example_and_required_flag(self):
        for slug_cn, slug_en, fields in self.gen.CUSTOMER_SHEETS:
            for (rid, field, instr, example, req, _key, *_rest) in fields:
                with self.subTest(field=rid):
                    self.assertTrue(rid and field, f"{slug_cn}: missing id or field name")
                    self.assertTrue(instr, f"{slug_cn} {rid}: missing instructions")
                    self.assertTrue(example, f"{slug_cn} {rid}: missing example")
                    self.assertIn(req, (self.gen.REQUIRED, self.gen.OPTIONAL), f"{slug_cn} {rid}: bad required flag")

    def test_blank_template_answer_column_is_empty(self):
        for csv_name in CUSTOMER_SHEET_CSVS:
            rows = read_csv_rows(TEMPLATE_CSV_DIR / csv_name)
            for row in rows[1:]:
                self.assertEqual(row[5], "", f"{csv_name} row {row[0]}: template must ship blank")

    def test_regeneration_is_deterministic(self):
        """Regenerating reproduces the committed CSVs and README byte for byte and the xlsx content for content.

        (The xlsx zip embeds a save timestamp, so byte equality is not achievable;
        content equality is the property the template depends on.)
        """
        before = {
            p.name: hashlib.sha256(p.read_bytes()).hexdigest()
            for p in sorted(list(TEMPLATE_CSV_DIR.glob("*.csv")) + [TEMPLATE_README])
        }
        before_xlsx = xlsx_sheets()

        subprocess.run([sys.executable, str(REPO_ROOT / "tools" / "intake" / "generate.py")],
                       check=True, capture_output=True)

        after = {
            p.name: hashlib.sha256(p.read_bytes()).hexdigest()
            for p in sorted(list(TEMPLATE_CSV_DIR.glob("*.csv")) + [TEMPLATE_README])
        }
        after_xlsx = xlsx_sheets()
        self.assertEqual(before, after)
        self.assertEqual(before_xlsx, after_xlsx)


if __name__ == "__main__":
    unittest.main()
