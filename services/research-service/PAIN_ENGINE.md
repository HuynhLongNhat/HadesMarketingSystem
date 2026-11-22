# Vietnamese Pain Evidence — V4 baseline

This is a small extension of HADES's **existing** `services/research-service` FastAPI service.

- The SearXNG + Trafilatura `POST /research` endpoint returns `pain_signals` in addition to `sources`.
- Only successfully retrieved body text is used. Quotes are literal substrings of `extracted_content`.
- NestJS validates quotes again before storing each finding with its source reference in existing PostgreSQL `market_intelligence_findings`.
- The HADES Market Intelligence detail page includes a **Nỗi đau** tab linking hypotheses to the original pages.
- No extra service, queue, database, or migration is needed.
- The pain detector uses **zero LLM tokens**. The existing HADES full-report workflow **still calls its configured AI model**.

This baseline is NOT semantic NLP. It may miss implicit complaints or capture promotions as pain signals.
Treat all matches as low confidence, never as confirmed willingness to purchase.

## Tests

From `services/research-service`:

```sh
python -m pip install -r requirements.txt
python -m unittest discover -s tests -v
```

Run the existing NestJS/Next.js typechecks and manually verify the end-to-end
research flow against a locally running SearXNG before merging this PR.
