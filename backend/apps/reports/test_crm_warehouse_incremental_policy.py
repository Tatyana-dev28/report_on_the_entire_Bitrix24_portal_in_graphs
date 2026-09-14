from django.test import SimpleTestCase

from apps.reports.services.crm_warehouse_incremental_policy import (
    failed_ids_block_incremental_coverage,
)


class IncrementalCoveragePolicyTests(SimpleTestCase):
    def test_smart_process_failure_does_not_block(self):
        sources = [
            {"id": "deal-default", "type": "deal"},
            {"id": "smart-production", "type": "smartProcess"},
            {"id": "crm-form-default", "type": "crm_form"},
        ]
        self.assertEqual(
            failed_ids_block_incremental_coverage(
                ["smart-production", "crm-form-default"],
                sources,
            ),
            [],
        )

    def test_deal_failure_blocks(self):
        sources = [
            {"id": "deal-default", "type": "deal"},
            {"id": "smart-production", "type": "smartProcess"},
        ]
        self.assertEqual(
            failed_ids_block_incremental_coverage(["smart-production", "deal-default"], sources),
            ["deal-default"],
        )

    def test_unknown_failed_id_blocks(self):
        self.assertEqual(
            failed_ids_block_incremental_coverage(["mystery"], [{"id": "deal-default", "type": "deal"}]),
            ["mystery"],
        )
