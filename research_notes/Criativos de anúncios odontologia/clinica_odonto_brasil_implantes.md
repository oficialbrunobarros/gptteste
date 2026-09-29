# Odonto Brasil Implantes (@clinicaodontobrasil) — catálogo de anúncios e dissecação de criativos

> **Aviso de transparência (leia primeiro).** Nesta sessão, a política de egresso da rede bloqueou (HTTP 403 no CONNECT do proxy) todos os domínios necessários para captura ao vivo: `www.facebook.com`, `m.facebook.com`, `graph.facebook.com`, `www.instagram.com`, `adstransparency.google.com`, `www.youtube.com`, `www.tiktok.com`, além do próprio site da clínica (`clinicaodontobrasil.com.br`, `www.clinicaodontobrasil.com`) e de agregadores (`econodata.com.br`, `sinesp.org.br`, `dentistas.net.br`). O README do proxy (`/root/.ccr/README.md`) instrui a não contornar negações de política. **Portanto, nenhum anúncio foi capturado ao vivo na Biblioteca de Anúncios da Meta nem no Google Ads Transparency Center.** Tudo o que está abaixo sobre "anúncios" é inferência a partir de (a) copy orgânico e institucional obtido via trechos de busca (WebSearch funcionou) e (b) a descrição do perfil/grid fornecida no briefing. Cada item está marcado como **[CAPTURADO]** (texto vindo de resultado de busca com URL) ou **[INFERIDO]**.

## Como foi feita a pesquisa (o que funcionou e o que não funcionou)

### Takeaway
WebSearch foi o único canal que funcionou; Playwright/WebFetch/curl falharam por bloqueio de política de rede (não por login wall do Facebook). Nenhuma screenshot de anúncio pôde ser salva.

### Cited Findings
- Diagnóstico do proxy (`curl -sS "$HTTPS_PROXY/__agentproxy/status"`) registrou `connect_rejected — gateway answered 403 to CONNECT (policy denial or upstream failure)` para `www.facebook.com:443`, `adstransparency.google.com:443`, `ads.tiktok.com:443`, `graph.facebook.com:443`, `bigspy.com:443`, `www.foreplay.co:443`, `sistemas.cfo.org.br:443` — fonte: saída do comando nesta sessão (log local, sem URL pública).
- `curl` direto retornou código `000` (túnel recusado) para `https://www.facebook.com/ads/library/`, `https://adstransparency.google.com/`, `https://www.instagram.com/clinicaodontobrasil/`, `https://clinicaodontobrasil.com.br/`, `https://www.youtube.com/...`, `https://www.tiktok.com/@clinicaodontobrasil` — log local.
- WebFetch retornou `EGRESS_BLOCKED` para `www.instagram.com`, `m.facebook.com`, `clinicaodontobrasil.com.br`, `www.clinicaodontobrasil.com`, `www.econodata.com.br`, `www.sinesp.org.br`, `www.dentistas.net.br` — log local.
- Playwright: o pacote `playwright` (pip, v1.63.0) foi instalado, mas o Chromium pré-instalado em `/opt/pw-browsers` é a revisão `chromium-1194`, incompatível com a revisão exigida pela v1.63 (erro "Executable doesn't exist… playwright install"). Como o destino estava bloqueado de qualquer forma, não se tentou fixar versão. Script salvo em `/tmp/claude-0/-home-user-gptteste/dc82c9fb-d7d3-5f13-8ce3-d88c1d194354/scratchpad/adlib.py` (pronto para reuso em ambiente sem bloqueio). Nenhuma screenshot foi gerada.
- Tentativas de URL mobile (`m.facebook.com/ads/library`) e user-agent alternativo não fazem sentido aqui: o bloqueio ocorre no CONNECT do proxy antes de qualquer resposta do Facebook (não é login wall) — log local.

### Inferences
- Para obter o catálogo real, a busca precisa ser executada de uma máquina/rede sem essa política de egresso (ver instruções passo a passo na última seção).

### Gaps
- Nenhum ID de anúncio, data "Veiculação iniciada em", status ativo/inativo, plataforma, contagem de versões, headline ou rótulo de CTA de anúncio foi observado.

## Identidade da clínica, páginas e IDs (para abrir a Biblioteca de Anúncios)

### Takeaway
Existem pelo menos duas entidades no Facebook ligadas ao nome e uma conta no Instagram; o ID de página mais provável para a unidade de Itaim Paulista é **100069618833787**, e o vanity da página principal é **facebook.com/clinicaodontobrasil**.

### Cited Findings
- Instagram: "Odonto Brasil Implantes 🦷 (@clinicaodontobrasil)", 13K seguidores, 2.706 seguindo, 706 publicações; bio (verbatim do trecho de busca): "✨ Especialistas em Implantes e Prótese Protocolo 🦷 Excelência em Reabilitação ❤️ 40 anos transformando sorrisos 📍 Itaim Paulista" — [Instagram @clinicaodontobrasil](https://www.instagram.com/clinicaodontobrasil/) **[CAPTURADO via snippet]**
- Página principal do Facebook: "Odonto Brasil Implantes | São Paulo SP", descrita como consultório "com 32 anos de experiência especializado em implantes"; e-mail `clinicaodontobrasil@gmail.com`; site `clinicaodontobrasil.com.br`; 878 curtidas, 6.474 check-ins; "92% recomendam (22 avaliações)" — [facebook.com/clinicaodontobrasil](https://www.facebook.com/clinicaodontobrasil/) e [about](https://m.facebook.com/clinicaodontobrasil/about/) **[CAPTURADO via snippet]**
- Página/perfil "Odonto Brasil Implantes Itaim Paulista | São Paulo SP", ID **100069618833787** — [m.facebook.com/100069618833787/about](https://m.facebook.com/100069618833787/about/) **[CAPTURADO via snippet]**
- Segundo perfil "Odonto Brasil Implantes", ID **100089181463867**; um resultado de busca o rotula como "Odonto Brasil Implantes | Goiânia GO" e outro como perfil de pessoa — [facebook.com/people/Odonto-Brasil-Implantes/100089181463867](https://m.facebook.com/people/Odonto-Brasil-Implantes/100089181463867/); [facebook.com/100089181463867](https://www.facebook.com/100089181463867) **[CAPTURADO via snippet; vínculo com a unidade de SP não confirmado]**
- Razão social: Clinica Odonto Brasil Implantes Ltda, CNPJ 46.642.396/0001-71, abertura 02/06/2022; administradoras: Laila Borin El Alam e Sarah Pereira dos Santos; endereço Rua Prof. Carlos de Assis Figueiredo, 36 – Vila Silva Teles, São Paulo-SP — [Econodata](https://www.econodata.com.br/consulta-empresa/46642396000171-clinica-odonto-brasil-implantes-ltda) **[CAPTURADO via snippet]**
- Telefones: fixo +55 11 2561-2909; WhatsApp/celulares (11) 91240-4867, (11) 92448-7663, (11) 95192-7376; horário seg–sex 08:00–19:00, sáb 08:00–16:00; serviços listados: implantes, estética dental, clareamento, prótese, ortodontia, clínica geral — [clinicaodontobrasil.com.br](https://clinicaodontobrasil.com.br/) **[CAPTURADO via snippet]**
- Dentistas: Dr. Rogério El Alam ("pioneiro em implantes dentários na Zona Leste de São Paulo", "mais de 30 anos") e Dra. Laila El Alam (filha) — [clinicaodontobrasil.com.br](https://clinicaodontobrasil.com.br/) **[CAPTURADO via snippet]**
- A clínica aparece como conveniada do SINESP (sindicato de servidores) na categoria Odontologia — [sinesp.org.br/convenios/odontologia](https://www.sinesp.org.br/convenios/odontologia) **[CAPTURADO via snippet; teor do desconto não capturado]**
- Não há canal do YouTube nem conta TikTok localizáveis para esta clínica; os resultados "Rede Odonto Brasil" (Curitiba) e "Odonto Brasil" de Vitória da Conquista/Maringá/Goiânia são homônimos não relacionados — [busca site:youtube.com](https://www.youtube.com/@odontobrasil) e [site:tiktok.com] **[CAPTURADO: ausência de resultados]**

### Inferences
- **[INFERIDO]** A página que provavelmente roda os anúncios é a principal (`facebook.com/clinicaodontobrasil`), vinculada ao Instagram @clinicaodontobrasil. O ID 100069618833787 ("Itaim Paulista") pode ser a mesma página vista pelo endpoint mobile ou uma segunda página local; confira os dois na Biblioteca.
- **[INFERIDO]** O CNPJ de 2022 com "40 anos" no branding indica reestruturação societária recente de um negócio familiar antigo (o pai fundou, a filha administra) — relevante para o argumento de "tradição" nos criativos.

### Gaps
- Não foi possível confirmar qual dos dois IDs (ou o vanity) é o anunciante real, nem se o perfil 100089181463867 pertence à mesma empresa.
- Endereço homônimo "Clínica Odontologia Brasil" em dentistas.net.br/guiafacil não foi verificado (pode ser outra clínica).

## Quantos anúncios ativos / quantos nos últimos 12 meses / quais os mais longevos (winners)

### Takeaway
**Não determinado.** A Biblioteca de Anúncios da Meta e o Google Ads Transparency Center estavam inacessíveis por política de rede; nenhuma contagem ou data pode ser afirmada.

### Cited Findings
- Nenhuma fonte indexada publicamente menciona anúncios pagos desta clínica; a busca por `"Odonto Brasil Implantes" anúncio OR "biblioteca de anúncios"` retornou apenas conteúdo genérico de agências (Odonto Results etc.) — [resultado de busca, ex.: blog.odontoresults.com.br](https://blog.odontoresults.com.br/post/99-ideias-anuncios-implante-dentario) **[CAPTURADO: ausência]**

### Inferences
- **[INFERIDO]** O perfil verificado com 13,9k seguidores em um bairro periférico, o site com landing de "avaliação 100% gratuita" e três números de WhatsApp distintos (91240-4867 na bio do IG; 92448-7663 e 95192-7376 no site/posts) são sinais típicos de tráfego pago ativo com rastreio por número (um número por canal/campanha). Isso é hipótese, não evidência.

### Gaps
- Contagem de anúncios ativos, histórico de 12 meses, datas de início e anúncios mais longevos: **não capturados**. Ver a seção final para obter em 5 minutos a partir de uma rede sem bloqueio.

## Quais hooks, copies e ofertas eles usam

### Takeaway
O copy institucional e orgânico capturado gira em torno de cinco eixos: **velocidade** ("sorriso em até 72 horas" / "protocolo entregue em menos de 24 horas"), **ausência de dor**, **tradição familiar/autoridade** ("40 anos", "+40.000 vidas"), **acesso financeiro** (avaliação gratuita, parcelamento direto sem banco) e **prova social** (avaliações Google, depoimentos, antes/depois).

### Cited Findings (copy verbatim ou quase-verbatim capturado)
- Post orgânico no Facebook (02/05/2024), título/legenda reconstruída a partir do slug da URL: **"Dente fixo, o famoso protocolo! Vem você também ganhar um novo sorriso #dentefixo #im[plante]…"** — [m.facebook.com/clinicaodontobrasil/photos/…/937395185058120/](https://m.facebook.com/clinicaodontobrasil/photos/dente-fixo-o-famoso-protocolovem-voc%C3%AA-tamb%C3%A9m-ganhar-um-novo-sorriso-dentefixo-im/937395185058120/) **[CAPTURADO]**
- Reel no Instagram: **"Protocolo entregue em menos de 24 horas! Mais um sorriso…"** — [instagram.com/clinicaodontobrasil/reel/DOo1VJTko6y/](https://www.instagram.com/clinicaodontobrasil/reel/DOo1VJTko6y/) **[CAPTURADO: título do snippet]**
- Post no Instagram: **"Itaim Paulista 📲 Fale com a nossa equipe: (11) 95192-…"** — [instagram.com/p/DJ9_k1qynVN/](https://www.instagram.com/p/DJ9_k1qynVN/) **[CAPTURADO: título do snippet]**
- Post no Instagram (institucional/história): **"A história da Odonto Brasil foi construída com bases…"** — [instagram.com/p/DcBwtZYPV-c/](https://www.instagram.com/p/DcBwtZYPV-c/) **[CAPTURADO: título do snippet]**
- Site (headlines resumidas pelo mecanismo de busca; não verbatim garantido): "Recupere seu sorriso em até 72 horas, sem dor"; "Avaliação 100% gratuita"; "Parcelamento direto com a clínica, sem aprovação bancária demorada e sem intermediários"; "Condições acessíveis para que nenhum paciente precise esperar pelo tratamento ideal por questões financeiras"; "Mais de 35 anos de tradição familiar e mais de 40.000 vidas transformadas na Zona Leste"; "Prótese protocolo sobre implantes: solução fixa, estável e confortável que substitui todos os dentes de forma natural, devolvendo qualidade de vida, autoestima e liberdade no dia a dia"; "Implantes de titânio que duram décadas"; "Dr. Rogério foi pioneiro em implantes dentários na Zona Leste… reputação construída em cuidado, ética e resultados reais"; "atendimento direto por WhatsApp" — [clinicaodontobrasil.com.br](https://clinicaodontobrasil.com.br/) **[CAPTURADO via snippets de busca]**
- Bio do Instagram (verbatim): "✨ Especialistas em Implantes e Prótese Protocolo 🦷 Excelência em Reabilitação ❤️ 40 anos transformando sorrisos 📍 Itaim Paulista" — [Instagram](https://www.instagram.com/clinicaodontobrasil/) **[CAPTURADO]**
- Prova social no Facebook: "92% recomendam (22 avaliações)" — [facebook.com/clinicaodontobrasil](https://www.facebook.com/clinicaodontobrasil/) **[CAPTURADO via snippet]**
- Depoimentos citados em snippet (paráfrase do mecanismo): "atendida com profissionalismo, atenção e cuidado desde a avaliação inicial até a conclusão… resultado superou as expectativas"; "toda a equipe, da recepção à cirurgia, super profissional, super recomendo" — [Instagram/Google via busca](https://www.instagram.com/clinicaodontobrasil/) **[CAPTURADO como paráfrase; não verbatim]**
- Elementos do grid/bio informados no briefing (não capturados nesta sessão): "Paixão Pelo Seu Sorriso", "+40 Anos Transformando Sorrisos", "Dentes Fixos em 72H", "Agende Sua Avaliação", wa.me/5511912404867; destaques Localização / Resultados / 40 anos / Depoimentos / Especialidades; posts: vídeo antes/depois, print de avaliação Google sobre foto do dentista, talking-head começando com "Olha,", card de texto "Às vezes o que você precisa é de um novo sorriso", grid antes/depois de implantes, fotos dos dentistas com pacientes — **[FORNECIDO NO BRIEFING]**

### Inferences (dissecação dos criativos prováveis — tudo [INFERIDO])
- **Hook principal = promessa de tempo**: "Dentes fixos em 72h" (bio) e "Protocolo entregue em menos de 24 horas" (reel) tratam a carga imediata como argumento de urgência/conveniência. É o gancho mais provável dos anúncios de conversão.
- **Hook secundário = "Olha, …"**: abertura coloquial de talking-head (dentista falando à câmera) é o padrão de vídeo vertical "UGC-style" que a Meta favorece em 2025–26; provável criativo de topo/meio de funil, com objeção ("dá para fazer em 72h?", "dói?", "quanto custa?").
- **Oferta**: nunca preço explícito nos materiais capturados; a oferta é "avaliação 100% gratuita" + "parcelamento direto com a clínica" (remove barreira de crédito, típico de público Zona Leste). Esperar nos anúncios variações "avaliação gratuita", "sem juros"/"parcele direto conosco", "sem dor".
- **Prova**: print de avaliação Google sobre foto de dentista em atendimento = criativo estático de prova social barato e reutilizável; antes/depois (foto e vídeo) = prova de resultado; "40 anos" / "+40.000 vidas" = autoridade. Card de texto "Às vezes o que você precisa é de um novo sorriso" = hook emocional/identificação, provável para remarketing.
- **Localização**: "Itaim Paulista" aparece na bio, no post e no destaque; nos anúncios deve haver segmentação por raio (Zona Leste: Itaim Paulista, Guaianases, São Miguel, Ferraz, Poá, Itaquaquecetuba).

### Gaps
- Textos primários, headlines e versões de anúncio: não capturados. Não se sabe se o "Olha," é seguido de alguma alegação de preço (atenção: o CFO restringe preço/"grátis" em publicidade odontológica; o uso de "avaliação 100% gratuita" no site sugere que a clínica aceita esse risco).

## Qual CTA e destino (WhatsApp, DM, site)

### Takeaway
Todo o ecossistema capturado converge para **WhatsApp**: bio com link `wa.me`, site com "atendimento direto por WhatsApp", posts com "Fale com a nossa equipe: (11) 95192-…". O destino provável dos anúncios é click-to-WhatsApp (ou site → WhatsApp).

### Cited Findings
- Link na bio do Instagram: wa.me/5511912404867 (WhatsApp (11) 91240-4867) — **[FORNECIDO NO BRIEFING]**; número também listado no site — [clinicaodontobrasil.com.br](https://clinicaodontobrasil.com.br/) **[CAPTURADO via snippet]**
- Post do Instagram com CTA telefônico: "📲 Fale com a nossa equipe: (11) 95192-…" — [instagram.com/p/DJ9_k1qynVN/](https://www.instagram.com/p/DJ9_k1qynVN/) **[CAPTURADO]**
- Site descreve "atendimento direto por WhatsApp" e "agende sua avaliação gratuita pelo WhatsApp" — [clinicaodontobrasil.com.br](https://clinicaodontobrasil.com.br/) **[CAPTURADO via snippet]**
- Post do Facebook com CTA implícito "Vem você também ganhar um novo sorriso" — [Facebook post 937395185058120](https://m.facebook.com/clinicaodontobrasil/photos/dente-fixo-o-famoso-protocolovem-voc%C3%AA-tamb%C3%A9m-ganhar-um-novo-sorriso-dentefixo-im/937395185058120/) **[CAPTURADO]**

### Inferences
- **[INFERIDO]** CTA de botão mais provável nos anúncios: "Enviar mensagem" (WhatsApp) ou "Saiba mais" → site/landing. O uso de três celulares distintos (91240-4867, 92448-7663, 95192-7376) sugere atribuição por canal (bio/Instagram, site, anúncios/posts).
- **[INFERIDO]** Funil: anúncio → WhatsApp → triagem por atendente → agendamento de "avaliação gratuita" presencial → fechamento de protocolo/implante com parcelamento próprio.

### Gaps
- Rótulo exato do botão e URL de destino de cada anúncio: não capturados.

## Quais formatos dominam

### Takeaway
Pelo grid descrito e pelos posts indexados, dominam **vídeo vertical curto** (antes/depois e talking-head) e **estáticos de prova social** (print de avaliação, antes/depois em grade, foto de equipe com paciente); carrossel não é evidenciado.

### Cited Findings
- Reels de resultado ("Protocolo entregue em menos de 24 horas! Mais um sorriso…") — [reel DOo1VJTko6y](https://www.instagram.com/clinicaodontobrasil/reel/DOo1VJTko6y/) **[CAPTURADO]**
- Foto orgânica de protocolo ("Dente fixo, o famoso protocolo!") — [Facebook photo 937395185058120](https://m.facebook.com/clinicaodontobrasil/photos/dente-fixo-o-famoso-protocolovem-voc%C3%AA-tamb%C3%A9m-ganhar-um-novo-sorriso-dentefixo-im/937395185058120/) **[CAPTURADO]**
- 706 publicações no perfil (volume alto de conteúdo orgânico reaproveitável como criativo) — [Instagram](https://www.instagram.com/clinicaodontobrasil/) **[CAPTURADO]**
- Descrição do grid recente: vídeo antes/depois, print de avaliação Google sobre foto do dentista, talking-head "Olha,", card de texto, grade antes/depois, fotos dentista+paciente — **[FORNECIDO NO BRIEFING]**

### Inferences
- **[INFERIDO]** Padrão de "boost" típico de clínica local: os mesmos posts orgânicos (reel de entrega de protocolo, print de avaliação, antes/depois) são impulsionados via Instagram; nesse caso aparecem na Biblioteca como anúncios com o texto = legenda do post e destino "Perfil do Instagram"/WhatsApp.
- **[INFERIDO]** Para modelar: (1) reel vertical 9:16 de 15–30 s "entrega do protocolo" com legenda de tempo ("em menos de 24h/72h") e CTA WhatsApp; (2) talking-head "Olha, …" respondendo objeção + "avaliação gratuita"; (3) estático 4:5 com print de avaliação 5 estrelas sobre foto real da clínica; (4) card de texto emocional para remarketing.

### Gaps
- Proporção real entre formatos nos anúncios pagos, duração dos vídeos e número de versões por anúncio: não capturados.

## Instruções passo a passo para o usuário obter o catálogo real (5–10 min)

### Takeaway
Abra as URLs abaixo em um navegador comum (não precisa de login para ver anúncios de "todas as categorias" no Brasil), fotografe/exporte cada cartão de anúncio e preencha a tabela-modelo ao final.

### Cited Findings
- Biblioteca de Anúncios (busca por palavra-chave): https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=BR&q=odonto%20brasil%20implantes&search_type=keyword_unordered&media_type=all
- Biblioteca de Anúncios (busca pelo handle): https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=BR&q=clinicaodontobrasil&search_type=keyword_unordered
- Biblioteca de Anúncios por ID de página (unidade Itaim Paulista): https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=BR&view_all_page_id=100069618833787&search_type=page&media_type=all
- Biblioteca de Anúncios por ID do segundo perfil (verificar se é a mesma empresa): https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=BR&view_all_page_id=100089181463867&search_type=page&media_type=all
- Alternativa: abra https://www.facebook.com/clinicaodontobrasil/ → "Sobre" → "Transparência da Página" → "Ir para a Biblioteca de Anúncios" (mostra o ID numérico correto e se a página está veiculando anúncios agora).
- Google Ads Transparency Center: https://adstransparency.google.com/?region=BR (digite "Odonto Brasil Implantes" ou o domínio `clinicaodontobrasil.com.br`).
- No perfil do Instagram: https://www.instagram.com/clinicaodontobrasil/ → menu "⋯" → "Sobre esta conta" → "Anúncios ativos" (mostra anúncios ativos vinculados ao perfil).
- Script Playwright pronto (ajustar versão do browser e rodar em rede sem bloqueio): `/tmp/claude-0/-home-user-gptteste/dc82c9fb-d7d3-5f13-8ce3-d88c1d194354/scratchpad/adlib.py` — gera `adlib_<chave>.png/.txt/.html` no mesmo diretório.

### Inferences
- Tabela-modelo para preencher por anúncio: `ID da Biblioteca | Veiculação iniciada em | Ativo? | Plataformas (FB/IG/Messenger/Audience Network) | Formato (vídeo/imagem/carrossel) | Texto primário (verbatim) | Headline | Botão CTA | Destino (wa.me / instagram.com / site) | Nº de versões | Descrição visual (hook nos 3 primeiros segundos)`. Ordene por "Veiculação iniciada em" crescente: os ativos mais antigos são os prováveis "winners".

### Gaps
- Sem acesso, esta seção não pôde ser executada nesta sessão; nenhuma screenshot foi salva.
