from __future__ import annotations

from django.test import SimpleTestCase

from apps.bitrix.services.rest_client import (
    BITRIX_LIST_PAGE_SIZE,
    BitrixRestClient,
    BitrixRestError,
    BitrixRestResult,
    _extract_batch_list_items,
    _extract_list_page_items,
    build_batch_command,
)


class _FakeListClient(BitrixRestClient):
    """Minimal client: only call_list / call_method / call_batch are exercised."""

    def __init__(self):
        self.max_list_pages = 200
        self.method_calls: list[tuple[str, dict]] = []
        self.batch_calls: list[dict[str, str]] = []
        self._pages: dict[int, BitrixRestResult] = {}
        self._batch_error: Exception | None = None

    def call_method(self, method: str, params: dict | None = None):  # type: ignore[override]
        params = dict(params or {})
        self.method_calls.append((method, params))
        if method == "batch":
            raise AssertionError("batch must go through call_batch in these tests")
        start = int(params.get("start") or 0)
        return self._pages[start]

    def call_batch(self, commands: dict[str, str], *, halt: bool = False):  # type: ignore[override]
        self.batch_calls.append(dict(commands))
        if self._batch_error is not None:
            raise self._batch_error
        result_map = {}
        for key, command in commands.items():
            # page_50 / page_100
            start = int(key.split("_", 1)[1])
            page = self._pages[start]
            result_map[key] = page.result
        return BitrixRestResult(result={"result": result_map})


class CallListBatchTests(SimpleTestCase):
    def test_extract_list_page_items_shapes(self):
        self.assertEqual(_extract_list_page_items([{"ID": "1"}]), [{"ID": "1"}])
        self.assertEqual(
            _extract_list_page_items({"items": [{"ID": "2"}]}),
            [{"ID": "2"}],
        )
        self.assertEqual(
            _extract_list_page_items({"tasks": {"7": {"id": "7"}}}),
            [{"id": "7"}],
        )

    def test_extract_batch_list_items(self):
        payload = {
            "result": {
                "page_50": [{"ID": "50"}],
                "page_100": [{"ID": "100"}],
            }
        }
        rows = _extract_batch_list_items(payload, ["page_50", "page_100"])
        self.assertEqual(rows, [{"ID": "50"}, {"ID": "100"}])

    def test_build_batch_command_flattens_filter(self):
        command = build_batch_command(
            "crm.deal.list",
            {
                "start": 50,
                "filter": {">=DATE_CREATE": "2026-01-01"},
                "select": ["ID", "TITLE"],
            },
        )
        self.assertTrue(command.startswith("crm.deal.list?"))
        self.assertIn("start=50", command)
        self.assertIn("filter", command)

    def test_call_list_uses_batch_when_total_known(self):
        client = _FakeListClient()
        client._pages = {
            0: BitrixRestResult(
                result=[{"ID": str(i)} for i in range(0, 50)],
                total=120,
                next=50,
            ),
            50: BitrixRestResult(
                result=[{"ID": str(i)} for i in range(50, 100)],
                total=120,
                next=100,
            ),
            100: BitrixRestResult(
                result=[{"ID": str(i)} for i in range(100, 120)],
                total=120,
                next=None,
            ),
        }

        rows = client.call_list("crm.deal.list", {"filter": {"CATEGORY_ID": 0}})

        self.assertEqual(len(rows), 120)
        self.assertEqual(rows[0]["ID"], "0")
        self.assertEqual(rows[-1]["ID"], "119")
        # First page via call_method, remaining via one batch (2 starts).
        self.assertEqual(len(client.method_calls), 1)
        self.assertEqual(client.method_calls[0][0], "crm.deal.list")
        self.assertEqual(len(client.batch_calls), 1)
        self.assertEqual(set(client.batch_calls[0]), {"page_50", "page_100"})

    def test_call_list_falls_back_to_sequential_without_total(self):
        client = _FakeListClient()
        client._pages = {
            0: BitrixRestResult(result=[{"ID": "1"}], total=None, next=50),
            50: BitrixRestResult(result=[{"ID": "2"}], total=None, next=None),
        }

        rows = client.call_list("crm.lead.list", {})

        self.assertEqual(rows, [{"ID": "1"}, {"ID": "2"}])
        self.assertEqual(len(client.batch_calls), 0)
        self.assertEqual(len(client.method_calls), 2)

    def test_call_list_falls_back_when_batch_fails(self):
        client = _FakeListClient()
        client._batch_error = BitrixRestError("batch failed")
        client._pages = {
            0: BitrixRestResult(
                result=[{"ID": str(i)} for i in range(BITRIX_LIST_PAGE_SIZE)],
                total=60,
                next=50,
            ),
            50: BitrixRestResult(
                result=[{"ID": str(i)} for i in range(50, 60)],
                total=60,
                next=None,
            ),
        }

        rows = client.call_list("crm.deal.list", {})

        self.assertEqual(len(rows), 60)
        self.assertEqual(len(client.batch_calls), 1)
        # Sequential restart: start=0 then start=50.
        self.assertGreaterEqual(len(client.method_calls), 3)
