# pumpfun-sim — simulador de scalping (paper trading) para memecoins da Pump.fun

Simulador em tempo real que **observa** o mercado da Pump.fun pelo WebSocket público do PumpPortal e
**simula** uma estratégia de scalping (entrar cedo em moedas com tração, sair por alvo/stop/tempo) com
matemática exata da bonding curve, latência, slippage e todos os custos. O objetivo é responder com números
se a estratégia dá **lucro líquido** depois de tudo.

> **Regra inviolável: modo simulação.** Nenhuma transação é enviada à blockchain. Não há chave privada,
> seed ou modo "live". Existe apenas a interface `Executor` com a implementação `PaperExecutor`.
> Adicionar um executor real seria uma decisão separada, fora deste projeto.

## Índice

1. [Como iniciar](#1-como-iniciar)
2. [Passo obrigatório: amostrar o WebSocket real](#2-passo-obrigatório-amostrar-o-websocket-real)
3. [Painel](#3-painel)
4. [Onde ajustar parâmetros](#4-onde-ajustar-parâmetros)
5. [Relatórios e backtest](#5-relatórios-e-backtest)
6. [Rodar 24/7 com pm2](#6-rodar-247-com-pm2)
7. [Arquitetura](#7-arquitetura)
8. [Como a simulação funciona](#8-como-a-simulação-funciona)
9. [Filtro Jev (opcional)](#9-filtro-jev-opcional)
10. [Verificação feita e o que ficou pendente](#10-verificação-feita-e-o-que-ficou-pendente)
11. [Limitações conhecidas](#11-limitações-conhecidas)

## 1. Como iniciar

Requisitos: Node.js 20+ (testado em 22).

```bash
cd pumpfun-sim
npm install
cp .env.example .env        # opcional; só é preciso para o Jev
npm test                    # testes unitários + validação da curva (se houver amostras)
npm start                   # WebSocket + motor + painel + relatório diário às 23:55
```

`npm start` conecta em `wss://pumpportal.fun/api/data`, abre o painel em <http://localhost:3000> e começa a
observar moedas novas. Para encerrar, `Ctrl+C`: as posições simuladas abertas são fechadas a preço de mercado,
tudo é salvo e a conexão é fechada.

Variáveis de ambiente úteis (`.env` ou na linha de comando):

| Variável | Efeito |
|---|---|
| `FEED_MODE=synthetic` | usa o gerador sintético em vez do PumpPortal (testes offline) |
| `RESET_BANKROLL=1` | recomeça a banca em `risk.bankrollUsd` em vez de continuar do valor salvo |
| `LOG_LEVEL=debug` | logs mais verbosos (pino) |
| `LOG_JSON=1` | logs em JSON (padrão quando não há terminal, ex.: pm2) |
| `PORT`, `DB_PATH`, `CONFIG_PATH` | sobrescrevem porta do painel, caminho do banco e do `config.yaml` |
| `TYPESAFE_API_KEY` | liga o filtro Jev |

## 2. Passo obrigatório: amostrar o WebSocket real

Antes de confiar nos resultados, grave mensagens reais e confira os campos:

```bash
npm run sample                 # grava ~50 criações, ~200 trades e as migrações que aparecerem em samples/
npm run inspect-samples        # mostra a união dos campos reais e como os schemas zod os classificam
npm run validate-curve         # compara a fórmula da curva com os trades reais e grava samples/curve-validation.json
npm test                       # o teste "bate com trades REAIS" deixa de ser pulado quando samples/trades.jsonl existe
```

**Importante — o que NÃO pôde ser feito no ambiente onde este projeto foi construído:** a política de rede
do ambiente bloqueou os hosts `pumpportal.fun`, `pump.fun`, `api.coingecko.com` e `api.typesafe.ai`
(HTTP 403 no proxy de saída). Por isso:

- os schemas em `src/feed/schemas.ts` foram escritos a partir da documentação pública do PumpPortal
  (campos `signature, mint, traderPublicKey, txType, initialBuy, solAmount, tokenAmount, newTokenBalance,
  bondingCurveKey, vTokensInBondingCurve, vSolInBondingCurve, marketCapSol, name, symbol, uri, pool`), com
  campos incertos como opcionais e `.passthrough()` para não perder nada. **Rode `npm run inspect-samples`
  e ajuste o que divergir.**
- a validação da fórmula contra trades reais está implementada (`src/curveValidation.ts`) e testa duas
  hipóteses para o campo `solAmount` (líquido de taxa ou bruto), além da consistência `ΔvSol == solAmount`.
  O **erro médio ainda não foi medido com dados reais**; ele será impresso por `npm run validate-curve` e
  gravado em `samples/curve-validation.json`. Copie o número para esta seção quando rodar.
- a taxa da curva (`curve.feePct`, padrão 1,25%) e o SOL de graduação (`curve.graduationSol`, padrão 85)
  não puderam ser conferidos em <https://pump.fun/docs/fees> e <https://pump.fun/docs/bonding-curve>.
  Estão configuráveis; confira e ajuste.
- a verificação ponta a ponta de 10 minutos (seção 10) foi feita com o **feed sintético**
  (`src/feed/synthetic.ts`), que emite mensagens no mesmo formato do PumpPortal.

Se estiver rodando no Claude Code na web, libere esses hosts em *Network access* do ambiente e repita
os passos acima; localmente basta ter internet.

## 3. Painel

<http://localhost:3000> (porta em `dashboard.port`). Página única, sem build, atualiza a cada 3 s:
banca, PnL do dia e total, taxa de acerto, fator de lucro, drawdown máximo, operações/hora, tempo médio,
curva de patrimônio (Chart.js), posições abertas, últimas 50 operações, quebra por motivo de saída / idade /
% da curva / com × sem Jev (com sombra), status do WebSocket, moedas em observação, rejeições por filtro e eventos.

API: `GET /api/state` (JSON com tudo acima) e `GET /api/health`.

## 4. Onde ajustar parâmetros

Tudo em **`config.yaml`**, validado por `zod` (`src/config.ts`) e **recarregado a quente** ao salvar
(se ficar inválido, a versão anterior continua valendo e o erro vai para o log).

| Seção | O que controla |
|---|---|
| `feed` | modo (`pumpportal`/`synthetic`), URL, `maxWatched` (150), TTL de observação, heartbeat (60 s) |
| `curve` | taxa da curva (1,25%), reservas virtuais iniciais (30 SOL / 1,073 bi tokens), SOL de graduação (85) |
| `costs` | taxa de execução de terceiros (0,5%), taxa de rede (0,0005 SOL), **latência** (1500 ms), slippage máximo (10%) |
| `entry` | idade 20–600 s, curva 8–60%, ≥12 compradores únicos/60 s, razão compra/venda ≥1,5, top-10 ≤35%, criador não vendeu, sem bundle forte, máx. 4 posições |
| `exit` | alvo líquido +15%, stop −8%, tempo máximo 180 s, trailing (desligado), penalidade de migração 5% |
| `risk` | banca US$ 100, posição US$ 8, limite diário US$ 15, cooldown 10 min após 3 stops, preço de reserva do SOL, fuso |
| `jev` | ligado/auto, modelo, timeout 800 ms, confiança de veto 0,7, modo sombra |
| `db` | caminho do SQLite, retenção de trades observados (7 dias), intervalo da curva de patrimônio |
| `report` / `backtest` | horário do relatório diário; grade de parâmetros do backtest |

Percentuais são em pontos percentuais (`1.25` = 1,25%).

## 5. Relatórios e backtest

```bash
npm run report                  # gera reports/AAAA-MM-DD.md (hoje) — também roda sozinho às 23:55
npm run report -- --date 2026-09-26
npm run backtest-params         # replay dos dados gravados com a grade de config.yaml; mostra as 10 melhores
npm run backtest-params -- --days 3 --top 20
```

O relatório traz todas as métricas do painel, as 10 melhores e piores operações, a quebra por motivo /
idade / curva / Jev e a comparação das médias das features entre ganhadoras e perdedoras.

O backtest reprocessa `tokens` + `trades_observed` (retenção `db.tradesRetentionDays`) pelo mesmo motor,
com latência e custos, para cada combinação da grade. Ele imprime um **aviso de sobreajuste** — leve a sério:
escolher parâmetros no mesmo período em que foram medidos infla o resultado, e o replay só contém as moedas
que entraram em observação (viés de seleção).

`REVIEW.md` tem um prompt pronto para pedir ao Claude Code uma revisão diária dos relatórios.

## 6. Rodar 24/7 com pm2

```bash
npm i -g pm2
pm2 start ecosystem.config.cjs
pm2 logs pumpfun-sim
pm2 stop pumpfun-sim          # envia SIGINT -> fecha posições simuladas e salva antes de sair
pm2 startup && pm2 save       # opcional: subir junto com o sistema
```

`kill_timeout` está em 15 s para dar tempo ao encerramento gracioso. Logs em `logs/`.

## 7. Arquitetura

```
src/
  main.ts                 sobe tudo (feed, motor, painel, agendador, sinais)
  config.ts               schema zod + LiveConfig (recarga a quente)
  curve.ts                matemática da bonding curve (produto constante sobre reservas virtuais)
  curveValidation.ts      validação da fórmula contra samples/trades.jsonl
  feed/                   schemas.ts (zod), pumpportal.ts (WS único, backoff, reassinatura, heartbeat),
                          synthetic.ts (gerador offline), replay.ts (backtest), types.ts (interface Feed)
  features/               tokenState.ts (janelas 10/30/60/180 s, detentores, criador, velocidade, bundle)
  strategy/               entry.ts (filtros), exit.ts (regras), engine.ts (orquestração)
  executor/               Executor.ts (interface), PaperExecutor.ts (latência, slippage, custos)
  risk/                   manager.ts (banca, limite diário, cooldown), solPrice.ts, time.ts (fuso)
  jev/client.ts           TypeSafe System One via SDK oficial (+ modo sombra no motor)
  db/db.ts                SQLite: tokens, trades_observed, positions, shadow_positions, events, equity, kv
  dashboard/              server.ts (express) + index.html (página única)
  reports/                metrics.ts, daily.ts, cli.ts, backtest.ts
scripts/                  sample.ts, inspect-samples.ts, validate-curve.ts
test/                     vitest (curva, features, executor, risco, schemas, motor, WS com servidor falso)
```

## 8. Como a simulação funciona

**Curva.** `k = vSol × vTokens`. Compra com `solIn`: taxa primeiro, depois
`tokensOut = vTokens − k / (vSol + solLíquido)`. Venda de `tokensIn`: `solOut = vSol − k / (vTokens + tokensIn)`,
taxa sobre `solOut`. Preço à vista `vSol / vTokens`. % da curva = `(vSol − 30) / 85`. A nossa ordem usa o
estado real da curva, então o **impacto do nosso tamanho no preço é contabilizado**, mas não alteramos o
estado compartilhado (somos observadores).

**Latência.** Toda decisão (compra ou venda) vira uma ordem pendente que só executa `latencyMs` depois, com
o estado da curva conhecido naquele instante — isto é, já incluindo os trades de terceiros que chegaram no
meio. Se o preço subiu mais que `maxSlippagePct` desde a decisão, a **compra é cancelada**; vendas sempre executam.

**Custos por lado.** Taxa da curva (1,25%) + taxa de execução de terceiros (0,5%) + taxa de rede (0,0005 SOL).
Uma ida e volta imediata perde ≈ 3,5% + duas taxas de rede — é o que a estratégia precisa vencer.

**Features (por moeda, janelas 10 s / 30 s / 60 s / 3 min).** Idade, % da curva, volume de compra/venda,
compradores únicos, razão compra/venda, concentração top-1/5/10 (saldos reconstruídos dos trades, usando
`newTokenBalance` quando presente), comportamento do criador (compra na criação, saldo, se já vendeu),
variação de preço 10 s / 60 s, maior queda em 60 s e sinal de bundle (≥5 compras de carteiras distintas
com valores parecidos nos 2 s após a criação = forte).

**Saída.** O que disparar primeiro: criador vendeu → stop (−8% líquido) → alvo (+15% líquido) → trailing
(opcional) → tempo máximo (180 s). Migração/graduação fecha imediatamente no último preço da curva com
penalidade de 5%. Encerramento (SIGINT/SIGTERM) fecha tudo a mercado.

**Risco.** Banca em USD convertida a SOL pelo preço atual (CoinGecko → Coinbase → Binance → Kraken, cache
5 min, valor de reserva configurável); posição fixa em USD; limite de perda diária no fuso
`America/Sao_Paulo` (para de abrir até a meia-noite e registra o evento); cooldown após 3 stops seguidos.
A banca persiste entre reinícios (tabela `kv`); posições órfãs de uma queda são fechadas a zero no boot.

**Persistência.** `data/sim.db` (SQLite, WAL). `trades_observed` guarda os trades de todas as moedas
observadas por `db.tradesRetentionDays` (7 dias) para o backtest; `equity` grava a curva de patrimônio a cada minuto.

## 9. Filtro Jev (opcional)

Com `TYPESAFE_API_KEY` no `.env`, antes de cada entrada o motor chama o TypeSafe System One
(`POST https://api.typesafe.ai/v1/systemone`, modelo `jev-latest`) pelo SDK oficial `@typesafe-ai/sdk`.
O formato de requisição segue exatamente os tipos do SDK (`state` + `questions` dos tipos `noul`,
`score`, `choice`); não foi inventado. Perguntas: `is_likely_scam` (noul), `meme_traction` (score 0–10),
`category` (choice: `meme_forte`, `meme_fraco`, `golpe_provavel`, `incerto`). O `state` leva nome, símbolo,
descrição (buscada no `uri` de metadados com timeout de 1,5 s), idade, % da curva, compradores únicos,
concentração e comportamento do criador.

Veto se `is_likely_scam ≥ jev.scamConfidence` (0,7). Timeout de 800 ms: estourou, segue sem o Jev e registra.
A resposta é gravada em cada posição. **Modo sombra:** as entradas vetadas são simuladas em
`shadow_positions` sem afetar a banca, para comparar com × sem Jev no painel e no relatório.

## 10. Verificação feita e o que ficou pendente

Feito neste ambiente (sem acesso ao PumpPortal):

- `npm test`: 37 testes passando (curva, ida e volta ≈ 2× taxa, casos-limite, features, executor com latência
  e slippage, risco e fuso, schemas, motor determinístico, motor + gerador sintético, cliente WebSocket contra
  um servidor falso com queda/reconexão/reassinatura/heartbeat). 1 teste **pulado**: validação contra
  trades reais, que exige `samples/trades.jsonl`.
- Execução de 10 minutos com `FEED_MODE=synthetic` (seed 2026, uma moeda nova a cada ~3 s), encerrada com
  SIGINT (encerramento gracioso confirmado no log e na tabela `events`):

  | Item | Resultado |
  |---|---|
  | Moedas vistas / em observação no fim | 213 / 150 (`maxWatched`) |
  | Trades observados gravados | 28.020 |
  | Avaliações de entrada | 17.312 |
  | Rejeições por filtro | top10_concentration 10.691 · curve_min 8.060 · buy_sell_ratio_60s 7.740 · unique_buyers_60s 7.303 · creator_sold 2.595 · max_open_positions 2.485 · age_min 2.195 · bundle_strong 1.016 · cooldown 350 · curve_max 104 |
  | Operações fechadas | 38 (20 ganhas / 18 perdidas; 16 alvo, 16 stop, 6 tempo máximo) |
  | PnL líquido | +0,0629 SOL (US$ 9,43 a SOL = US$ 150 de reserva) · custos 0,1111 SOL |
  | Fator de lucro / drawdown máx. | 1,79 / 1,96% |
  | Tempo médio de posição | 55 s |
  | Eventos | ws_connected, config_reloaded (recarga a quente testada), cooldown (3 stops seguidos), shutdown |
  | Painel | `GET /api/health` e `GET /api/state` OK; página renderizada com todas as seções (screenshot via Chromium) |
  | `npm run report` | gerou `reports/2026-09-26.md` (cópia em `reports/exemplo-feed-sintetico.md`) |
  | `npm run backtest-params` | 324 combinações em ~5,5 min sobre os 28k trades gravados |

  **Esses números são do gerador sintético e não dizem nada sobre a estratégia real.** O gerador tem
  arquétipos caricatos ("organic", "runner", "rug", "dud", "bundle") e existe só para exercitar o pipeline.

  Sobre a fidelidade do replay (`backtest-params`): reproduzindo a mesma gravação, o replay repetiu
  exatamente as 13 primeiras operações do modo real; a partir daí divergiu por uma diferença de fase do
  timer de 250 ms (uma saída por tempo máximo caiu 113 ms depois e uma entrada foi bloqueada por
  `maxOpenPositions`), e o sistema é caótico o bastante para que isso mude o resto. Ou seja: o replay é
  fiel na mecânica, mas não é bit a bit igual ao tempo real — mais um motivo para não sobreajustar.

Pendente para quem tiver rede (você):

1. `npm run sample` → `npm run inspect-samples` → ajustar `src/feed/schemas.ts` se algum campo divergir.
2. `npm run validate-curve` → anotar o erro médio aqui: **erro médio: _pendente_**.
3. Conferir `curve.feePct` e `curve.graduationSol` na documentação da Pump.fun.
4. Rodar `npm start` por horas/dias com o feed real antes de tirar conclusões.

## 11. Limitações conhecidas

- **Não há execução real.** A ordem simulada não altera a curva de verdade; em moedas finas a nossa própria
  compra moveria o mercado e atrairia bots — o simulador só contabiliza o impacto matemático do nosso tamanho.
- **Latência e slippage são modelados, não medidos.** 1500 ms fixos; na prática a latência varia e falhas
  de transação (tx dropada, preço fora do limite) existem.
- **MEV/sandwich, front-running e concorrência de snipers** não são simulados; costumam piorar o resultado.
- **Reconstrução de detentores** só vê os trades depois que a moeda entrou em observação (normalmente desde
  a criação) e ignora transferências diretas de tokens.
- **Dados sintéticos são caricaturas**; qualquer número obtido com `FEED_MODE=synthetic` serve para testar o
  pipeline, não a estratégia.
- **Taxas da Pump.fun podem ter mudado** (a plataforma já alterou o regime de taxas mais de uma vez); estão
  configuráveis, mas confira.
- **Preço do SOL** afeta só a conversão para USD (tamanho da posição e limite diário); o PnL é medido em SOL.
- **Backtest com viés de seleção e sobreajuste**: só há trades das moedas que entraram em observação, e a
  grade escolhe parâmetros no mesmo período em que os avalia.
