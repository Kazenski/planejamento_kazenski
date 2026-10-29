# AGENTS.md: contexto do projeto Planejamento Kazenski

Leia este arquivo inteiro antes de qualquer tarefa neste projeto. Ele registra as decisões já tomadas, para que o trabalho continue sem refazer análises.

Responda sempre em **português do Brasil**.

## 1. Objetivo

Site pessoal do professor Eduardo (Kazenski) para criar, guardar e reutilizar **planejamentos técnicos** de aula, no contexto do ensino médio técnico em TI do território catarinense.

Os planejamentos são **salvos e independentes por ano**. Cada plano tem colégio, turma, quantidade de alunos e quantidade de aulas, então cada um é único. A ideia é reaproveitar o que já existe e só inserir o que for novo.

Usuário: somente Edu, por enquanto. O sistema já nasce com `user_id` para aceitar mais professores no futuro.

## 2. Mapa de arquivos

| Caminho | O que é | Pode alterar? |
|---|---|---|
| `AGENTS.md` | Este arquivo (memória do projeto) | Sim, manter atualizado |
| `README.md` | Documentação para o GitHub: uso, deploy, estrutura | Sim |
| `docs/regras-de-negocio.md` | Regras de negócio acordadas e inconsistências resolvidas | Sim |
| `anexos/` | Materiais-base e modelos de planejamento enviados por Edu (cópia local) | **Não versionar** (está no `.gitignore`). Só leitura |
| `.gitignore` | Impede subir `anexos/`, `.env` e chaves | Sim, com cuidado |

Arquivos do Edu nunca são sobrescritos. Os PDFs em `anexos/` são só leitura.

## 3. Fontes de base (anexos)

| Arquivo em `anexos/` | Conteúdo | Uso |
|---|---|---|
| `Currículo Educação Digital (2).pdf` (419 p.) | Currículo de Educação Digital de SC. Traz habilidades **EF** e **EM13CO01 a EM13CO26** (computação), com propostas didáticas | Catálogo de habilidades e exemplos de práticas |
| `Caderno 3 . Currículo Base do Ensino Médio de Santa Catarina.pdf` (344 p.) | Currículo Base do Ensino Médio do Território Catarinense, com trilhas de aprofundamento da **educação técnica e profissional** (seção 6, a partir da p. 20) | Base do eixo técnico e das trilhas de TI |
| `BNCCComputaoCompletodiagramado (4).pdf` (75 p.) | BNCC Computação (141 habilidades, 3 eixos: Pensamento Computacional, Mundo Digital, Cultura Digital) | Catálogo nacional de habilidades de computação |

Os PDFs são grandes (acima de 20 MB em um caso), então não cabem na leitura direta da ferramenta `read`. Para consultar, extraia o texto com Python (pypdf). Os textos extraídos ficam em pasta temporária, não no projeto.

Regra: só citar código de habilidade que estiver nesses documentos. Se não encontrar, não invente.

## 4. Decisões de negócio (não reabrir sem pedido)

1. **Etapa:** técnico em TI, ensino médio (1º, 2º e 3º anos do técnico).
2. **Ano letivo:** fevereiro a dezembro (11 meses). Janeiro não tem planejamento. Julho é tratado como mês normal, mas aceita recesso cadastrado (ver calendário).
3. **Dias letivos:** o ano tem **200 dias letivos** (LDB, art. 24). É um valor de **configuração geral editável** em um menu de gestão. "Dias úteis" é o calendário; "dias letivos" é dia de aula. O sistema mostra a diferença.
4. **Diário:** só se gera a partir de um plano mensal. Não há plano para dia de feriado ou de dia não letivo. O sistema gera a lista de dias letivos do mês, já descontando feriados e eventos do colégio.
5. **Fonte da verdade:** o **plano anual**. O mensal e o diário são recortes dele.
6. **Quantidade de alunos:** só entra no cabeçalho do plano. Não influencia o conteúdo.
7. **Eventos de calendário:** podem valer para um, vários ou todos os colégios (seleção múltipla).
8. **Login:** Google (Supabase Auth). Acesso ao Google Drive para importar materiais (ver seção 7).
9. **Materiais:** ficam em pasta do Drive com acesso "qualquer pessoa com o link". Os modelos de planejamento ficam em outra pasta do Drive.
10. **Repositório:** GitHub, privado, em `Kazenski/planejamento_kazenski`.
11. **Publicação:** GitHub Pages (conta paga). Para testes, servidor local (`python -m http.server`).
12. **IA:** o site chama a API de um modelo por uma **Edge Function** do Supabase. A chave nunca vai para o navegador. Modelo inicial: Gemini (chave do Google AI Studio). Confirmar nome e limites atuais antes de implementar.
13. **Feriados nacionais:** BrasilAPI (`https://brasilapi.com.br/api/feriados/v1/{ano}`), sem chave. Feriados estaduais, municipais e pontos facultativos são cadastrados pelo próprio site.
14. **Visual:** cores do projeto `agile_Kazenski` (laranja `FF5000`, azul-marinho `001A2E`, cinza `666666`, azul `0066FF`, fundo de card `F2F4F7`). Fonte Open Sans.
15. **Nome de marca:** "Planejamento Kazenski".
16. **Modelo de site:** o repositório `Kazenski/painel_agilista_2026` é a referência de estrutura (HTML, CSS e JS puros em módulos ES, Supabase com RLS, Chart.js via CDN, dialogs, menu superior, backup JSON). **Diferença:** aqui o banco é **relacional** (tabelas próprias), não a tabela única `agilista_dados` em JSON, porque o planejamento precisa de consultas, versões e métricas por habilidade.

## 5. Fluxo de geração

```
Cadastros (colégios, turmas, disciplinas, aulas/semana, calendário)
        │
        ▼
PLANO ANUAL (ano, colégio, turma, disciplina)   ← fonte da verdade
        │  3 trimestres, conteúdos, habilidades, materiais, avaliações
        ▼
PLANO MENSAL (fev a dez)   ← recorte do anual
        │  o professor marca conteúdos a mais/a menos
        │  a IA ajusta o mensal e propõe a nova versão do anual
        ▼
PLANO DIÁRIO (um por dia letivo do mês)
           gerado a partir dos dias letivos do calendário
```

### 5.1 Anual
- Entrada: ano, colégio, turma, disciplina, quantidade de alunos, aulas por semana (da disciplina na turma), e a lista de conteúdos do ano.
- Ao virar o ano: o sistema **copia** o anual do ano anterior (`origem_id`). O professor então marca cada conteúdo como **mantido, novo, alterado ou removido**. Cada ano é independente.
- Saída: 3 trimestres, com conteúdos detalhados, habilidades (códigos), materiais, avaliações e tópicos extensos para adaptar ao documento do colégio.

### 5.2 Mensal
- Pré-requisito: plano anual do mesmo colégio, turma e disciplina.
- O professor escolhe o mês e marca o que quer incluir (conteúdo novo) e o que quer tirar ou adiar.
- Ajuste no anual: **nova versão** do anual, com prévia das diferenças. Só vira versão nova depois da confirmação. Os meses afetados e os diários ligados ficam marcados como **desatualizados**.
- Conteúdo não trabalhado no mês: o professor escolhe entre replanejar para o mês seguinte ou só registrar.

### 5.3 Diário
- Pré-requisito: plano mensal gerado.
- Dias: dias úteis do mês menos feriados e eventos com `dia_letivo = false` para aquele colégio.
- Aulas por dia: derivadas de `aulas_semana` da disciplina e do dia da semana.
- Conteúdo: o que é ensinado naquele dia e a **prática docente** (como conduzir a aula).

## 6. Modelo de dados (rascunho para validação)

Todas as tabelas têm `user_id uuid default auth.uid()` e RLS por `user_id = auth.uid()`. Nomes em português, snake_case.

| Tabela | Campos principais | Observação |
|---|---|---|
| `configuracoes` | chave, valor (jsonb) | `dias_letivos_ano = 200`, `meses_planejamento = fev-dez` |
| `colegios` | nome, direcao, coordenacao, supervisao, emails_copia[], emails_envio_material[], ativo | Gestão separada no menu "Colégios" |
| `disciplinas` | nome, etapa ("técnico TI"), ativo | Menu de cadastro |
| `turmas` | colegio_id, nome, serie (1, 2, 3), curso, qtd_alunos, ano | Cabeçalho dos planos |
| `turma_disciplinas` | turma_id, disciplina_id, aulas_semana | Base do cálculo de aulas |
| `calendario_eventos` | data, tipo, nome, dia_letivo (bool), todos_colegios (bool) | Feriados, pontos facultativos, recessos, ações do colégio |
| `evento_colegios` | evento_id, colegio_id | Usado quando `todos_colegios = false` (seleção múltipla) |
| `habilidades` | codigo, descricao, documento_origem, eixo, competencia | Catálogo a partir dos anexos |
| `conteudos` | disciplina_id, nome, descricao | Biblioteca de conteúdos reutilizáveis |
| `planos_anuais` | ano, turma_id, disciplina_id, versao, origem_id, conteudo (jsonb), status | Fonte da verdade. Uma versão por ano |
| `planos_anuais_itens` | plano_anual_id, trimestre, conteudo_id, ordem, status_no_ano | Mantido, novo, alterado, removido |
| `planos_anuais_habilidades` | plano_anual_id, habilidade_id | Alimenta as métricas de habilidades |
| `planos_mensais` | plano_anual_id, mes, versao, conteudo (jsonb), ajustes (jsonb), status (atualizado/desatualizado) | Recorte do anual |
| `planos_diarios` | plano_mensal_id, data, aula_numero, conteudo (jsonb), pratica_docente | Um por dia letivo |
| `fontes_material` | nome, origem (drive ou storage), drive_file_id, tipo, status_indexacao | Materiais-base |
| `geracoes_ia` | tipo, entrada, saida, modelo, criado_em | Log, para auditoria e custo |

Os conteúdos de cada plano ficam em `jsonb` com esquema validado. Os campos que alimentam gráficos (trimestre, habilidades, status) ficam em colunas ou tabelas próprias.

## 7. Google: login e Drive

**Login (Supabase Auth, provedor Google):**
1. Criar um projeto no Google Cloud Console e configurar a tela de consentimento OAuth (tipo externo, modo de teste, com Edu como usuário de teste).
2. Criar um cliente OAuth 2.0 (aplicativo web). Em "URI de redirecionamento autorizado" colocar `https://sqqtcshgfriwinpvvszp.supabase.co/auth/v1/callback`.
3. No Supabase: Authentication > Providers > Google, colar Client ID e Client Secret.
4. Em Authentication > URL Configuration: Site URL e Redirect URLs com `https://kazenski.github.io/planejamento_kazenski/` e `http://localhost:8000/`.

**Drive (leitura dos materiais e dos modelos):**
- Escopo recomendado: `https://www.googleapis.com/auth/drive.readonly`. Permite ler os arquivos das pastas que você indicar.
- Não usar `drive.file`: ele só enxerga arquivos criados ou abertos pelo próprio app.
- O escopo é "restrito". Para uso pessoal, em modo de teste, não exige verificação do app. Modo de teste: o login com Google expira a cada sessão. Pode pedir consentimento de novo.
- O token do Google que o Supabase devolve dura cerca de 1 hora. Serve para importar os arquivos no momento do login. Não guardar o token.
- Pastas "qualquer pessoa com o link": testar se o acesso por chave de API funciona, sem login. Confirmar antes de implementar.
- Para os PDFs, o Gemini aceita o arquivo inteiro (sem extrair texto). Para uma base grande, ver seção 8.

## 8. IA: uso, custo e base

- **Quem chama a IA:** Edge Function `gerar-planejamento` no Supabase. A chave fica em `supabase secrets` (`GEMINI_API_KEY`), nunca no front-end.
- **Como o site chama:** o navegador envia o JWT do usuário logado. A função confere o usuário, monta o prompt com a base e chama o modelo.
- **Base pequena (poucos arquivos):** entra inteira no prompt, ou como arquivos enviados ao modelo.
- **Base grande (dezenas de livros de Python, por exemplo):** quebrar os textos em trechos, gerar embeddings e guardar no Supabase com **pgvector**. Na geração, buscar só os trechos relevantes. Drive guarda os originais; o Supabase guarda o índice.
- **Saída:** sempre JSON com esquema fixo. A função valida antes de gravar. Se não validar, não grava e mostra o erro.
- **Chave do Gemini:** Edu cria no Google AI Studio. No plano gratuito, o Google pode usar os dados enviados para melhorar produtos. Para material com nomes de professores e colégios, considerar o plano pago. Confirmar limites e preços atuais antes da implementação.
- **Alternativa:** Anthropic (Claude), com chave própria e cobrança por uso. A troca de modelo fica em uma única função.
- **Limite do assistente de desenvolvimento:** a IA que programa o projeto não roda dentro do site. Para o site gerar conteúdo, é preciso uma chave de API configurada na Edge Function.

## 9. Stack e deploy

- **Front-end:** HTML, CSS e JavaScript puros (módulos ES), sem build, como o painel_agilista. Chart.js via CDN para os gráficos.
- **Banco e autenticação:** Supabase (projeto `planejamento_kazenski`, `https://sqqtcshgfriwinpvvszp.supabase.co`). Chave publicável no front-end, protegida por RLS.
- **Funções:** Supabase Edge Functions (IA, importação do Drive, feriados).
- **Hospedagem:** GitHub Pages, branch `main`, pasta raiz. Site público; os dados ficam atrás do login e do RLS.
- **Segredos:** nunca no repositório. Não gravar em arquivo: chaves de API, token `sbp_...`, `service_role`.
- **Local:** `python -m http.server 8000`, depois `http://localhost:8000`.

## 10. Métricas (painel)

Gráficos esperados, com dados do próprio banco:
- Planos por ano, colégio e status (anual, mensal, diário).
- Aulas planejadas x aulas letivas do ano (meta 200).
- Habilidades mais usadas, por documento de origem (BNCC Computação, Educação Digital SC, Caderno 3).
- Competências mais trabalhadas, por eixo.
- Conteúdos reaproveitados entre anos (quantos mantidos, novos e removidos).

## 11. Estado atual (v0.1)

**Feito:**
- Repositório privado `Kazenski/planejamento_kazenski`. Site publicado em `https://kazenski.github.io/planejamento_kazenski/` (GitHub Pages, branch `main`, raiz).
- Esquema aplicado no Supabase (14 tabelas, RLS ativo, uma política por usuário, `anon` sem acesso). Arquivo: `supabase/migrations/0001_esquema_inicial.sql`.
- Google Cloud: cliente OAuth "Supabase - Planejamento Kazenski" no projeto `kazenski`. Login configurado no Supabase (provedor Google ativo, Site URL e Redirect URLs corretos).
- Edge Function `gerar-planejamento` publicada, com verificação de login (JWT). Falta o segredo `GEMINI_API_KEY`.
- Telas: login, painel (gráficos), calendário (feriados BrasilAPI, eventos com seleção de colégios, modal por dia), colégios, disciplinas, turmas, aulas por disciplina, planos (anual, mensal, diário), materiais (Drive), configurações (meta de dias letivos).

**Decisões de publicação:**
- Projeto `kazenski` em modo **Em produção**, por decisão do Edu. O login usa só escopos básicos (sem aviso e sem expiração). O Drive usa `drive.readonly` com autorização separada. Ao conectar o Drive, o Google mostra aviso de app não verificado e limita a 100 usuários. Ao publicar, verificar outros clientes do projeto que pedem escopos sensíveis.
- Trimestres (premissa, confirmar com o Edu): 1º fev–abr, 2º mai–ago, 3º set–dez. Está em `assets/js/planos.js` (constante `TRIMESTRES`).

**Versão 0.2 (calendário, painel e anos):**
- Migração `0002_eventos_catalogo_e_anos.sql` aplicada: catálogo `eventos_catalogo` (lançamentos escolhem dele), coluna `ano` em `colegios` e `disciplinas`, e `calendario_eventos.catalogo_id`.
- Calendário: seletor de colégio no cabeçalho; navegação de mês e ano centralizada; contadores de feriados nacionais, feriados + emendas, atividades pedagógicas e eventos curriculares extras; lançamentos do mês visíveis; gestão do catálogo abaixo do calendário; seleção múltipla de dias.
- Definições usadas nos contadores (premissas, confirmar com o Edu): **emenda** = dia útil sem feriado cujo dia útil anterior ou seguinte é feriado (fins de semana são ignorados). **Atividade pedagógica** = tipo `acao_pedagogica`. **Evento curricular extra** = tipo `evento_colegio`.
- Painel: barras empilhadas por categoria de dia (letivo, feriado, recesso/ponto, atividade pedagógica, evento extra) e tabela de aulas por disciplina no ano (respeita o calendário de cada colégio).
- Materiais: o indicador de conexão do Drive agora confere a permissão no Google (`tokeninfo`), e a tela mostra as permissões recebidas.

**Acesso de teste (TEMPORÁRIO):**
- Formulário de e-mail e senha na tela de login (bloco `<details id="acesso-teste">` em `index.html`, funções `entrarComSenha` em `auth.js` e listener em `app.js`). Marcado com comentários "TEMPORÁRIO".
- Usuário de teste: `teste@planejamento-kazenski.com` (criado no Supabase Auth, e-mail confirmado).
- Para remover: apagar o bloco e os trechos marcados como TEMPORÁRIO; no Supabase, excluir o usuário de teste (Authentication > Users).
- Não há senha no repositório.

**Pendências:**
0. Remover o acesso de teste (ver acima) antes do uso final.
1. Edu criar a chave do Gemini (Google AI Studio) e configurar: `supabase secrets set GEMINI_API_KEY=...`. Confirmar o nome do modelo (`GEMINI_MODEL`, padrão `gemini-2.5-flash`).
2. Testar o login ponta a ponta no site publicado (o teste automático não passa pelo login Google).
3. Edu enviar os links das pastas do Drive (materiais e modelos), colar em Materiais e listar.
4. Indexação do conteúdo dos materiais para a IA. Hoje a função usa só nomes dos arquivos e o catálogo de habilidades. Próxima etapa: extrair texto, quebrar em trechos e gerar embeddings no pgvector.
5. Popular a tabela `habilidades` com os códigos dos anexos (EF, EM13CO01 a EM13CO26 e BNCC Computação). Hoje a tabela está vazia, então os vínculos de habilidades não são gravados.
6. Revisar o texto gerado pela IA na primeira geração (formato, profundidade e vínculo com o documento do colégio).
7. Versionar mensal: hoje cada mês tem um único registro (regerar sobrescreve). Ver se precisa de histórico.
8. Ao aplicar a proposta do mensal no anual, a nova versão herda o plano antigo até ser gerada de novo. Confirmar se o Edu prefere limpar o plano nesse caso.
