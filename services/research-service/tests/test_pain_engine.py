"""Offline tests; no network, no LLM."""
import unittest

from app.pain_engine import analyze_evidence


class PainEngineTests(unittest.TestCase):
    def source(self, content, status="retrieved"):
        return {"canonical_url": "https://example.org/p/1",
                "extraction_status": status, "extracted_content": content}

    def test_quote_is_exact_original_vietnamese(self):
        body = "Mở quán nhiều tháng mà không có khách, cần thuê đơn vị hỗ trợ."
        matches = analyze_evidence([self.source(body)])
        self.assertEqual(len(matches), 1)
        self.assertIn(matches[0]["quote"], body)
        self.assertEqual(matches[0]["confidence"], "low")
        self.assertEqual(matches[0]["category"], "customer_acquisition")

    def test_unretrieved_and_snippet_only_are_excluded(self):
        self.assertEqual(analyze_evidence([self.source("ít khách", "failed")]), [])
        self.assertEqual(analyze_evidence([{
            "canonical_url": "https://example.org", "extraction_status": "retrieved", "snippet": "ít khách",
        }]), [])

    def test_same_category_per_source_not_counted_twice(self):
        self.assertEqual(len(analyze_evidence([self.source("không có khách, ít khách, khó tìm khách")])), 1)

    def test_advertising_penalized_not_verified_purchase(self):
        match = analyze_evidence([self.source("Chúng tôi cung cấp giải pháp cho quán khó tìm khách.")])[0]
        self.assertEqual(match["signal_score"], 10)
        self.assertEqual(match["confidence"], "low")

    def test_implicit_pain_not_fabricated(self):
        self.assertEqual(analyze_evidence([self.source("Bàn ghế quán trống trơn mỗi tối.")]), [])


if __name__ == "__main__":
    unittest.main()
