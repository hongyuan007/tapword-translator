# Batch Translation API Requirements

## Endpoint
POST /api/v1/translate/batch

## Request
```json
{
  "texts": ["text1", "text2", "..."],
  "source_lang": "en",
  "target_lang": "zh",
  "context": "optional page context"
}
```

## Response
```json
{
  "translations": ["翻译1", "翻译2", "..."],
  "source_lang": "en",
  "target_lang": "zh"
}
```

## Notes
- Maximum 10 texts per request
- Maximum 5000 characters total per request
- Texts should be paragraph-level blocks
- Currently, the frontend implements this by calling translateFragment in a loop
- A dedicated batch endpoint would reduce latency and enable server-side batching
