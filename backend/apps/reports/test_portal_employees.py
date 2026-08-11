from __future__ import annotations

from django.test import SimpleTestCase

from apps.reports.services.portal_employees import (
    _department_ids,
    _department_names_from_rows,
    _normalize_department_id,
    _normalize_portal_user,
)


class PortalEmployeesDepartmentTests(SimpleTestCase):
    def test_normalize_department_id_handles_float_strings(self):
        self.assertEqual(_normalize_department_id(101.0), "101")
        self.assertEqual(_normalize_department_id("105.0"), "105")
        self.assertEqual(_normalize_department_id("113"), "113")

    def test_department_ids_flatten_nested_values(self):
        self.assertEqual(_department_ids([[101], 105, "113.0"]), ["101", "105", "113"])

    def test_department_names_from_rows(self):
        names = _department_names_from_rows(
            [
                {"ID": 101, "NAME": "Продажи"},
                {"id": "105.0", "name": "Маркетинг"},
            ]
        )
        self.assertEqual(names, {"101": "Продажи", "105": "Маркетинг"})

    def test_normalize_portal_user_uses_department_names(self):
        user = {
            "ID": "7",
            "NAME": "Алексей",
            "LAST_NAME": "Ховрин",
            "UF_DEPARTMENT": [105, 101],
            "ACTIVE": "Y",
        }
        normalized = _normalize_portal_user(
            user,
            {"101": "Головной офис", "105": "Продажи"},
        )
        assert normalized is not None
        self.assertEqual(
            normalized["departments"],
            [
                {"id": "105", "name": "Продажи"},
                {"id": "101", "name": "Головной офис"},
            ],
        )
        self.assertEqual(normalized["department"], "Продажи, Головной офис")
