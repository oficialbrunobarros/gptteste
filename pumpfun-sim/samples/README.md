# samples/

Mensagens reais gravadas do WebSocket do PumpPortal por `npm run sample`:

- `new_tokens.jsonl` — eventos `txType: "create"`
- `trades.jsonl` — eventos `buy`/`sell` das primeiras moedas observadas (sequências por mint, usadas para validar a fórmula da curva)
- `migrations.jsonl` — eventos de graduação
- `other.jsonl` — qualquer outra coisa (mensagens de serviço etc.)
- `summary.json` — contagens e horários

Cada linha: `{"receivedAt": <epoch ms>, "msg": {...}}`.

Depois de gravar, rode `npm run inspect-samples` (campos reais × schemas) e `npm run validate-curve` (fórmula × trades reais).
