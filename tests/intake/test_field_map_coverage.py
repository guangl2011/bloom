"""Field-map coverage test: 100% of intake fields appear in the map.

Every intake field declared on a customer-facing sheet must have exactly one
field-map row (intake key → sheet → workflow-config keys → owning agent),
in both the CSV export and the xlsx workbook.
"""
import unittest

from tests.intake.helpers import (
    EXPECTED_SHEET_TITLES,
    TEMPLATE_CSV_DIR,
    load_generator,
    parse_field_map,
    read_csv_rows,
    xlsx_sheets,
)


class TestFieldMapCoverage(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.gen = load_generator()
        cls.declared = []  # (row_id, intake_key, sheet_label) straight from the generator's field data
        for slug_cn, slug_en, fields in cls.gen.CUSTOMER_SHEETS:
            for (rid, _field, _instr, _example, _req, key, _config, _agent, _note) in fields:
                cls.declared.append((rid, key, f"{slug_cn} / {slug_en}"))
        cls.declared_keys = [key for _rid, key, _sheet in cls.declared]

        cls.csv_fixture = parse_field_map(read_csv_rows(TEMPLATE_CSV_DIR / "08-field-map-internal.csv")[1:])
        xlsx_map = [row for row in xlsx_sheets()[EXPECTED_SHEET_TITLES[7]][1:]]
        cls.xlsx_fixture = parse_field_map(xlsx_map)

    def test_every_intake_field_appears_in_the_csv_field_map(self):
        mapped = set(self.csv_fixture.keys())
        missing = [key for key in self.declared_keys if key not in mapped]
        self.assertEqual(missing, [], f"{len(missing)} intake fields missing from the CSV field map")

    def test_every_intake_field_appears_in_the_xlsx_field_map(self):
        mapped = set(self.xlsx_fixture.keys())
        missing = [key for key in self.declared_keys if key not in mapped]
        self.assertEqual(missing, [], f"{len(missing)} intake fields missing from the xlsx field map")

    def test_field_map_has_no_extra_fields(self):
        declared = set(self.declared_keys)
        extra = [key for key in self.csv_fixture if key not in declared]
        self.assertEqual(extra, [], "field map references intake fields that no sheet declares")

    def test_coverage_is_exactly_100_percent(self):
        self.assertEqual(len(self.declared_keys), len(set(self.declared_keys)), "duplicate intake key declared")
        self.assertEqual(len(self.csv_fixture), len(self.declared_keys), "coverage is not 100%")

    def test_every_mapped_field_feeds_at_least_one_config_key(self):
        unmapped = [key for key, entry in self.csv_fixture.items() if not entry["config_keys"]]
        self.assertEqual(unmapped, [], f"intake fields with no workflow-config key: {unmapped}")

    def test_every_mapped_field_names_an_agent(self):
        unowned = [key for key, entry in self.csv_fixture.items() if not entry["agent"]]
        self.assertEqual(unowned, [], f"intake fields with no owning agent: {unowned}")

    def test_field_map_source_rows_point_back_at_the_customer_sheets(self):
        """Each map entry's source row id must exist on the sheet it claims."""
        ids_by_sheet = {}
        for slug_cn, slug_en, fields in self.gen.CUSTOMER_SHEETS:
            ids_by_sheet[f"{slug_cn} / {slug_en}"] = {f[0] for f in fields}
        for key, entry in self.csv_fixture.items():
            with self.subTest(key=key):
                self.assertIn(entry["sheet"], ids_by_sheet, f"{key}: unknown sheet {entry['sheet']}")
                source_id = entry["source"].split(" ")[0]
                self.assertIn(source_id, ids_by_sheet[entry["sheet"]],
                              f"{key}: source row {source_id} not found on {entry['sheet']}")

    def test_required_keys_are_a_subset_of_declared_fields(self):
        self.assertTrue(self.gen.REQUIRED_KEYS.issubset(set(self.declared_keys)),
                        "REQUIRED_KEYS contains keys no sheet declares")


if __name__ == "__main__":
    unittest.main()
