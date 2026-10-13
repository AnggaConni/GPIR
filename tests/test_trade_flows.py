import unittest

from pipeline.fetch_trade_flows import build_flow_records, choose_product_targets


class TradeFlowTests(unittest.TestCase):
    def test_targets_choose_latest_year_and_high_value_codes(self):
        snapshot = {
            "items": [
                {"market_iso3": "IDN", "latest_year": 2023, "product_code": "090111", "latest_import_usd": 100},
                {"market_iso3": "IDN", "latest_year": 2024, "product_code": "090111", "latest_import_usd": 80},
                {"market_iso3": "IDN", "latest_year": 2024, "product_code": "271012", "latest_import_usd": 400},
                {"market_iso3": "IDN", "latest_year": 2024, "product_code": "720720", "latest_import_usd": 200},
            ]
        }
        targets = choose_product_targets(snapshot, product_limit=2)
        self.assertEqual(targets["IDN"]["year"], 2024)
        self.assertEqual(targets["IDN"]["codes"], ["271012", "720720"])

    def test_import_rows_are_supplier_to_buyer_and_world_is_excluded(self):
        rows = [
            {
                "partnerCode": 156, "partnerISO": "CHN", "partnerDesc": "China",
                "cmdCode": "847130", "cmdDesc": "Portable computers", "period": 2024,
                "primaryValue": 1250000, "qty": 50, "netWgt": 250,
            },
            {
                "partnerCode": 0, "partnerISO": "W00", "partnerDesc": "World",
                "cmdCode": "847130", "cmdDesc": "Portable computers", "period": 2024,
                "primaryValue": 9000000,
            },
            {
                "partnerCode": 392, "partnerISO": "JPN", "partnerDesc": "Japan",
                "cmdCode": "847130", "cmdDesc": "Portable computers", "period": 2024,
                "primaryValue": 0,
            },
            {
                "partnerCode": 360, "partnerISO": "IDN", "partnerDesc": "Indonesia",
                "cmdCode": "847130", "cmdDesc": "Portable computers", "period": 2024,
                "primaryValue": 999999,
            },
        ]
        flows = build_flow_records(rows, "IDN", "Indonesia", 2024)
        self.assertEqual(len(flows), 1)
        self.assertEqual(flows[0]["supplier_iso3"], "CHN")
        self.assertEqual(flows[0]["buyer_iso3"], "IDN")
        self.assertEqual(flows[0]["product_code"], "847130")
        self.assertEqual(flows[0]["import_value_usd"], 1250000)
        self.assertNotEqual(flows[0]["supplier_iso3"], flows[0]["buyer_iso3"])

    def test_invalid_partner_and_invalid_product_codes_are_skipped(self):
        rows = [
            {"partnerCode": 999, "partnerISO": "???", "partnerDesc": "Unknown", "cmdCode": "123456", "primaryValue": 20},
            {"partnerCode": 156, "partnerISO": "CHN", "partnerDesc": "China", "cmdCode": "TOTAL", "primaryValue": 100},
        ]
        self.assertEqual(build_flow_records(rows, "IDN", "Indonesia", 2024), [])


if __name__ == "__main__":
    unittest.main()
