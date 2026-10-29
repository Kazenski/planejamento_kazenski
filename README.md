# Planejamento Kazenski

Site pessoal para criar, guardar e reutilizar planejamentos técnicos de aula (ensino médio técnico em TI, Santa Catarina).

Cada planejamento é salvo por ano, colégio, turma e disciplina. Ao virar o ano, o professor copia o planejamento anterior e ajusta apenas o que mudou.

> Status: **em planejamento**. As regras estão em [`docs/regras-de-negocio.md`](docs/regras-de-negocio.md). A memória de contexto para a IA está em [`AGENTS.md`](AGENTS.md).

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
index.html                       página principal
assets/css/style.css             visual (cores do agile_Kazenski)
assets/js/config.js              URL e chave publicável do Supabase
assets/js/auth.js                login com Google
assets/js/store.js               leitura e gravação no Supabase
assets/js/app.js                 telas, formulários, gráficos
supabase/migrations/             esquema do banco (SQL)
supabase/functions/              Edge Functions (IA, Drive, feriados)
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
5. **Deploy das Edge Functions:**
   ```bash
   supabase functions deploy gerar-planejamento
   supabase functions deploy importar-drive
   supabase functions deploy feriados
   ```

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
