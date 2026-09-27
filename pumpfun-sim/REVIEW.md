# Prompt de revisão diária (colar no Claude Code)

Cole o texto abaixo no Claude Code, dentro da pasta `pumpfun-sim/`, uma vez por dia (de preferência depois
das 23:55, quando o relatório do dia já existe).

---

Você é o revisor diário do meu simulador de scalping em memecoins da Pump.fun (pasta `pumpfun-sim/`,
paper trading — nada é real). Faça uma revisão objetiva e me devolva recomendações concretas para o
`config.yaml`. Não altere código nem o `config.yaml` sem eu pedir; proponha as mudanças como um diff.

Passos:

1. Leia o relatório mais recente em `reports/` (o de hoje ou de ontem) e os 2 anteriores, se existirem.
   Se o de hoje não existir, gere com `npm run report`.
2. Leia o `config.yaml` atual e o `README.md` (seções 8 e 11) para lembrar como a simulação funciona.
3. Consulte o banco quando precisar de detalhe (`sqlite3 data/sim.db` ou um script `tsx`): tabelas
   `positions`, `shadow_positions`, `events`, `equity`, `tokens`. Exemplos úteis:
   - PnL líquido por motivo de saída e por hora do dia;
   - taxa de cancelamento por slippage (`events.type = 'order_cancelled'`);
   - quantas moedas foram rejeitadas por cada filtro (chave `engine_stats` na tabela `kv`);
   - com × sem Jev (posições com `jev` não nulo × sombra).
4. Rode `npm run backtest-params -- --days 3` e leia as 10 melhores combinações **com ceticismo**:
   descarte picos isolados e combinações com N pequeno.

Responda nesta estrutura, em português, curto e direto:

- **Veredito do dia**: lucro/prejuízo líquido, fator de lucro, drawdown, operações/hora. Uma frase sobre se
  a estratégia está vencendo os custos (≈3,5% por ida e volta + taxas de rede).
- **O que mudou** em relação aos dias anteriores (tendência, não ruído).
- **Diagnóstico por motivo de saída**: onde o dinheiro está sendo perdido (stop? tempo máximo? criador
  vendeu?) e o que isso sugere.
- **Filtros**: quais features separam ganhadoras de perdedoras segundo a tabela do relatório; quais filtros
  estão rejeitando quase tudo (restritivos demais) ou deixando passar lixo.
- **Jev**: se estiver ligado, o veto está ajudando (comparar aprovadas × sombra)? Vale mudar
  `jev.scamConfidence`?
- **Custos e execução**: cancelamentos por slippage, impacto da latência, tamanho da posição × liquidez.
- **Proposta de ajustes ao `config.yaml`**: no máximo 3 mudanças, cada uma com o motivo, o valor atual → novo
  e o risco de sobreajuste (N de operações que embasa a sugestão). Formate como diff YAML.
- **Alertas**: eventos anormais (`daily_limit_hit`, `cooldown`, reconexões em série, erros), moedas em
  observação muito baixas, feed desconectado, posições órfãs.
- **Não mude ainda**: o que parece tentador mas tem base estatística fraca (N < 30 ou 1 dia só).

Regras: não invente números — cite de onde tirou cada um; se um dado não existir, diga isso; trate
qualquer resultado com menos de 100 operações como preliminar; lembre que o simulador não sofre MEV,
falhas de transação nem competição real, então o resultado real tende a ser pior.
