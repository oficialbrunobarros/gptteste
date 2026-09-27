# Relatório diário — 2026-09-26

Simulação (paper trading) de scalping em memecoins da Pump.fun. Fuso: America/Sao_Paulo.

## Resultado do dia

| Métrica | Valor |
|---|---|
| Operações fechadas | 38 (20 ganhas / 18 perdidas) |
| Taxa de acerto | 52.6% |
| PnL líquido | 0.06287 SOL (US$ 9.43) |
| Fator de lucro | 1.79 |
| Expectativa por operação | 3.07% |
| Ganho médio / perda média | 13.27% / -8.25% |
| Drawdown máximo | 1.65% |
| Operações por hora | 244.66 |
| Lucro por hora | US$ 60.72 |
| Tempo médio de posição | 55 s |
| Custos totais (taxas) | 0.11110 SOL |

## Acumulado (desde o início)

| Métrica | Valor |
|---|---|
| Operações fechadas | 38 (20 ganhas / 18 perdidas) |
| Taxa de acerto | 52.6% |
| PnL líquido | 0.06287 SOL (US$ 9.43) |
| Fator de lucro | 1.79 |
| Expectativa por operação | 3.07% |
| Ganho médio / perda média | 13.27% / -8.25% |
| Drawdown máximo | 1.96% |
| Operações por hora | 244.66 |
| Lucro por hora | US$ 60.72 |
| Tempo médio de posição | 55 s |
| Custos totais (taxas) | 0.11110 SOL |

## Quebra do resultado

### Por motivo de saída

| Faixa | N | Acerto | PnL líq. (SOL) | Média % |
|---|---|---|---|---|
| max_hold | 6 | 66.7% | -0.00230 | -0.71% |
| stop_loss | 16 | 0.0% | -0.07337 | -8.52% |
| take_profit | 16 | 100.0% | 0.13854 | 16.08% |

### Por idade na entrada

| Faixa | N | Acerto | PnL líq. (SOL) | Média % |
|---|---|---|---|---|
| 0-60s | 4 | 75.0% | 0.02282 | 10.60% |
| 180-300s | 7 | 42.9% | 0.00557 | 1.48% |
| 300-600s | 2 | 0.0% | -0.00990 | -9.19% |
| 60-180s | 25 | 56.0% | 0.04437 | 3.30% |

### Por % da curva na entrada

| Faixa | N | Acerto | PnL líq. (SOL) | Média % |
|---|---|---|---|---|
| <10% | 1 | 100.0% | 0.00889 | 16.51% |
| 10-20% | 19 | 36.8% | -0.02461 | -2.41% |
| 20-35% | 9 | 77.8% | 0.05600 | 11.56% |
| 35-60% | 9 | 55.6% | 0.02259 | 4.66% |

### Com × sem Jev (inclui sombra)

| Grupo | N | Acerto | PnL líq. (SOL) | Fator de lucro |
|---|---|---|---|---|
| sem Jev (filtro desligado) | 38 | 52.6% | 0.06287 | 1.79 |
| com Jev (aprovadas) | 0 | 0.0% | 0.00000 | 0.00 |
| sombra (vetadas pelo Jev, não operadas) | 0 | 0.0% | 0.00000 | 0.00 |

## 10 melhores operações do dia

| # | Símbolo | Saída | PnL % | PnL SOL | Duração | Jev |
|---|---|---|---|---|---|---|
| 21 | RUNN | take_profit | 18.26% | 0.00983 | 22s | - |
| 22 | RUNN | take_profit | 18.08% | 0.00973 | 29s | - |
| 4 | ORGA | take_profit | 17.87% | 0.00962 | 23s | - |
| 31 | RUNN | take_profit | 17.13% | 0.00922 | 29s | - |
| 23 | RUNN | take_profit | 16.87% | 0.00908 | 45s | - |
| 35 | RUNN | take_profit | 16.64% | 0.00896 | 35s | - |
| 9 | RUNN | take_profit | 16.52% | 0.00889 | 22s | - |
| 2 | ORGA | take_profit | 16.51% | 0.00889 | 21s | - |
| 29 | RUNN | take_profit | 15.81% | 0.00851 | 12s | - |
| 34 | RUNN | take_profit | 15.66% | 0.00843 | 34s | - |

## 10 piores operações do dia

| # | Símbolo | Saída | PnL % | PnL SOL | Duração | Jev |
|---|---|---|---|---|---|---|
| 7 | ORGA | stop_loss | -10.93% | -0.00589 | 68s | - |
| 33 | ORGA | stop_loss | -10.61% | -0.00571 | 97s | - |
| 26 | RUNN | stop_loss | -9.60% | -0.00517 | 36s | - |
| 20 | ORGA | stop_loss | -9.41% | -0.00507 | 9s | - |
| 14 | ORGA | stop_loss | -9.21% | -0.00496 | 8s | - |
| 16 | ORGA | stop_loss | -9.20% | -0.00496 | 105s | - |
| 37 | RUNN | stop_loss | -8.79% | -0.00473 | 4s | - |
| 11 | ORGA | stop_loss | -8.62% | -0.00464 | 9s | - |
| 38 | RUNN | stop_loss | -8.60% | -0.00463 | 3s | - |
| 30 | ORGA | stop_loss | -8.57% | -0.00461 | 20s | - |

## Quais filtros separam ganhadoras de perdedoras

Médias das features na ENTRADA (operações do dia). Diferenças grandes sugerem onde apertar/afrouxar o `config.yaml`.

| Feature | Ganhadoras | Perdedoras | Dif. |
|---|---|---|---|
| idade (s) | 100.41 | 147.40 | -32% |
| % curva | 26.82 | 24.24 | 11% |
| compradores únicos 60s | 70.80 | 53.83 | 32% |
| razão compra/venda 60s | 2.88 | 2.98 | -3% |
| volume compra 60s (SOL) | 19.83 | 12.79 | 55% |
| top-10 % | 29.24 | 28.21 | 4% |
| top-1 % | 5.01 | 5.22 | -4% |
| detentores | 98.60 | 104.44 | -6% |
| criador comprou (SOL) | 0.53 | 0.56 | -5% |
| criador detém % | 4.50 | 5.01 | -10% |
| var. preço 10s % | 8.12 | 5.25 | 55% |
| var. preço 60s % | 67.99 | 43.26 | 57% |
| maior queda 60s % | 5.74 | 3.88 | 48% |
| compras de bundle | 2.20 | 2.61 | -16% |
| trades totais | 186.50 | 211.56 | -12% |

## Rejeições por filtro (contadores da execução atual)

- top10_concentration: 10691
- curve_min: 8060
- buy_sell_ratio_60s: 7740
- unique_buyers_60s: 7303
- creator_sold: 2595
- max_open_positions: 2485
- age_min: 2195
- bundle_strong: 1016
- cooldown: 350
- curve_max: 104

Avaliações de entrada: 17312 · Moedas vistas: 213

## Eventos relevantes do dia

- 2026-09-27T00:39:02.631Z **cooldown** {"consecutiveStops":3,"until":1790470142625}

## Parâmetros vigentes

```yaml
entry: {"minAgeSec":20,"maxAgeSec":600,"minCurvePct":8,"maxCurvePct":60,"minUniqueBuyers60s":12,"minBuySellRatio":1.5,"maxTop10Pct":35,"creatorSoldBlocks":true,"blockStrongBundle":true,"maxOpenPositions":4}
exit: {"takeProfitPct":15,"stopLossPct":8,"maxHoldSec":180,"trailingPct":null,"migrationPenaltyPct":5}
costs: {"executionFeePct":0.5,"networkFeeSol":0.0005,"latencyMs":1500,"maxSlippagePct":10}
risk: {"positionUsd":8,"dailyLossLimitUsd":15}
```

> Limitações: simulação sem execução real; a nossa ordem não altera a curva de verdade; latência e slippage são modelados, não medidos; MEV/sandwich e falhas de transação não são simulados.
