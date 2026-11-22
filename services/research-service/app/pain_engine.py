"""Deterministic Vietnamese pain detection from verified public-page content.

Baseline only: literal phrase matches are NOT confirmed customer demand.
Every quote comes from the successfully extracted original text.
"""
from __future__ import annotations

import re

PAIN_PHRASES = {
    "customer_acquisition": ("khó tìm khách", "không có khách", "ít khách", "vắng khách", "không ra đơn", "khó chốt đơn", "thiếu khách hàng"),
    "customer_support": ("bỏ sót tin nhắn", "quá tải tin nhắn", "trả lời khách chậm", "không trả lời kịp", "khó chăm sóc khách"),
    "operations": ("quản lý bằng excel", "khó quản lý đơn", "sai sót đơn hàng", "tốn thời gian nhập liệu", "nhập liệu thủ công"),
    "marketing": ("quảng cáo không hiệu quả", "chạy quảng cáo không ra đơn", "chi phí quảng cáo cao", "không biết chạy quảng cáo"),
    "website": ("website chậm", "web chậm", "website bị lỗi", "không đặt hàng được", "website không hoạt động"),
}
INTENT_PHRASES = ("cần thuê", "xin báo giá", "tìm đơn vị", "có ai giới thiệu", "cần phần mềm")
PROMO_PHRASES = ("chúng tôi cung cấp", "mình nhận làm", "liên hệ để mua", "giảm giá sốc")


def analyze_evidence(sources: list[dict], max_signals: int = 60) -> list[dict]:
    """Extract evidence-bound pain hypotheses, never from snippets alone."""
    findings: list[dict] = []
    seen: set[tuple[str, str]] = set()
    for source in sources[:20]:
        if source.get("extraction_status") != "retrieved":
            continue
        text, url = source.get("extracted_content"), source.get("canonical_url")
        if not isinstance(text, str) or not text.strip() or not isinstance(url, str):
            continue
        for category, phrases in PAIN_PHRASES.items():
            match = next((m for phrase in phrases
                          if (m := re.search(r"(?<!\w)" + re.escape(phrase) + r"(?!\w)",
                                             text, re.IGNORECASE)) is not None), None)
            if not match or (url, category) in seen:
                continue
            left, right = max(0, match.start() - 90), min(len(text), match.end() + 90)
            # Preserve an exact raw substring. Do not strip since the quote must
            # be verifiable against stored extractedContent.
            quote = text[left:right]
            context = text[max(0, match.start() - 180):min(len(text), match.end() + 180)].casefold()
            intent = [term for term in INTENT_PHRASES if term in context]
            promo = [term for term in PROMO_PHRASES if term in context]
            findings.append({
                "canonical_url": url,
                "category": category,
                "quote": quote,
                "matched_phrase": match.group(0),
                "signal_score": max(0, min(100, 40 + (20 if intent else 0) - (30 if promo else 0))),
                "intent_terms": intent,
                "promotion_terms": promo,
                "verified": True,
                "confidence": "low",
            })
            seen.add((url, category))
            if len(findings) >= max_signals:
                return findings
    return findings
