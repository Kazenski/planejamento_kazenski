# Planejamento Kazenski

Site pessoal para criar, guardar e reutilizar planejamentos técnicos de aula (ensino médio técnico em TI, Santa Catarina).

Cada planejamento é salvo por ano, colégio, turma e disciplina. Ao virar o ano, o professor copia o planejamento anterior e ajusta apenas o que mudou.

> Status: **primeira versão funcional**. Login, cadastros, calendário, planos e painel estão construídos. A geração com IA depende da chave do Gemini (ver Configuração). Regras em [`docs/regras-de-negocio.md`](docs/regras-de-negocio.md). Memória do projeto em [`AGENTS.md`](AGENTS.md).

Site publicado em: https://kazenski.github.io/planejamento_kazenski/

## Funcionalidades previstas

- **Cadastros:** colégios (direção, coordenação, supervisão, e-mails), turmas, disciplinas, aulas por semana e configurações (200 dias letivos).
- **Calendário:** feriados nacionais (BrasilAPI) e eventos por colégio, com seleção múltipla.
- **Planejamento anual:** 3 trimestres, conteúdos, habilidades, materiais e avaliações.
- **Planejamento mensal:** fevereiro a dezembro, a partir do anual, com ajuste de conteúdos.
- **Planejamento diário:** um por dia letivo do mês, com prática docente.
- **Materiais:** importação do Google Drive e upload no Supabase Storage.
- **Painel:** gráficos de planos, aulas, habilidades e competências mais usadas.

## Tecnologia

| Parte | Escolha |
|---|---|
| Front-end | HTML, CSS e JavaScript puros (módulos ES), sem build |
| Banco, login e storage | [Supabase](https://supabase.com) (projeto `planejamento_kazenski`) |
| Login | Google (Supabase Auth) |
| Materiais | Google Drive (leitura) e Supabase Storage |
| IA | Edge Function no Supabase, com Gemini (chave em segredo) |
| Gráficos | Chart.js (CDN) |
| Hospedagem | GitHub Pages |

Referência de estrutura: [painel_agilista_2026](https://github.com/Kazenski/painel_agilista_2026).

## Estrutura do repositório

```
index.html                       página principal (login, menu, modal)
assets/css/style.css             visual (cores do agile_Kazenski)
assets/js/config.js              constantes (Supabase público, meses, tipos de evento)
assets/js/supabase.js            cliente do Supabase
assets/js/auth.js                login Google e conexão com o Drive
assets/js/db.js                  leitura e gravação no banco
assets/js/ui.js                  modal, formulários e mensagens
assets/js/regras.js              regras de dia letivo e distribuição de aulas (sem acesso ao banco)
assets/js/cadastros.js           colégios, disciplinas, turmas e aulas por disciplina
assets/js/calendario.js          calendário letivo, feriados e eventos
assets/js/planos.js              planos anual, mensal e diário
assets/js/materiais.js           pastas do Drive e arquivos registrados
assets/js/painel.js              gráficos e indicadores
assets/js/configuracoes.js       meta de dias letivos e regras gerais
assets/js/app.js                 login, rotas e menu
supabase/migrations/             esquema do banco (SQL)
supabase/functions/              Edge Function de IA (gerar-planejamento)
docs/                            regras de negócio e documentação
AGENTS.md                        memória do projeto para a IA
```

`anexos/` (materiais-base e modelos) **não é versionado**.

## Como rodar localmente

```bash
python -m http.server 8000
```

Acesse `http://localhost:8000`. Abrir o `index.html` com duplo clique não funciona, porque o navegador não carrega módulos JS dessa forma.

## Configuração (uma vez)

1. **Supabase:** aplicar as migrations de `supabase/migrations/` pelo SQL Editor ou pela CLI.
2. **Google Cloud:** criar o cliente OAuth (aplicativo web) e informar a URL de callback do Supabase (`https://sqqtcshgfriwinpvvszp.supabase.co/auth/v1/callback`).
3. **Supabase Auth:** ativar o provedor Google e configurar Site URL e Redirect URLs:
   - `https://kazenski.github.io/planejamento_kazenski/`
   - `http://localhost:8000/`
4. **Segredos das Edge Functions:**
   ```bash
   supabase secrets set GEMINI_API_KEY=...
   ```
5. **Deploy da Edge Function de IA:**
   ```bash
   supabase functions deploy gerar-planejamento --project-ref sqqtcshgfriwinpvvszp
   ```
   A função valida o login do usuário antes de gerar qualquer conteúdo.

## Deploy (GitHub Pages)

1. Repositório em `Kazenski/planejamento_kazenski`.
2. Em **Settings > Pages**: fonte "Deploy from a branch", branch `main`, pasta `/ (root)`.
3. Cada push para `main` publica em `https://kazenski.github.io/planejamento_kazenski/`.

Antes de publicar, conferir:
- Nenhum segredo no código (`service_role`, `sbp_...`, chave do Gemini).
- RLS ativo em todas as tabelas.
- Redirect URLs do Supabase apontando para o endereço do Pages.

## Segurança

- Repositório **privado**. A página do GitHub Pages é pública, mas os dados ficam atrás do login e do RLS.
- A chave publicável do Supabase pode ficar no front-end. A `service_role` nunca.
- Chaves de API não vão para arquivos versionados. Use `.env` (ignorado pelo Git) ou segredos do Supabase.

## Licença

Uso pessoal. Os materiais-base (currículos e livros) pertencem às suas fontes originais e não são distribuídos neste repositório.
