# Regras de negócio

Versão 0.1. Regras acordadas com o professor Eduardo Kazenski. Cada regra indica a origem da decisão quando ela corrige uma inconsistência.

## 1. Calendário e dias letivos

| Regra | Valor | Origem |
|---|---|---|
| Dias letivos por ano | 200 (configurável em Configurações) | LDB, art. 24, e decisão do professor |
| Meses de planejamento | Fevereiro a dezembro (11 meses) | Professor. Janeiro não tem planejamento |
| Dia útil | Segunda a sexta, descontando feriados nacionais | Calendário |
| Dia letivo | Dia útil que não está marcado como não letivo para o colégio | Regra do projeto |
| Dia sem plano | Feriado, recesso ou evento com `dia_letivo = false` | Professor |

**Correção de inconsistência:** o pedido original falava em "cerca de 25 dias úteis" por mês. Um mês tem no máximo 23 dias úteis, e 200 dias letivos em 11 meses dá cerca de 18 a 20 por mês. O sistema calcula os dias pelo calendário, não usa um número fixo.

## 2. Hierarquia dos planos

```
Plano anual (fonte da verdade)
  └── Plano mensal (um por mês, fev a dez)
        └── Plano diário (um por dia letivo do mês)
```

- Mensal depende de anual. Diário depende de mensal.
- Não existe diário sem mensal gerado.
- Não existe mensal sem anual do mesmo colégio, turma e disciplina.

## 3. Ano

- Cada ano é independente. Ao virar o ano, o anual do ano anterior é **copiado** como base (`origem_id`).
- Cada conteúdo do ano novo recebe um estado: **mantido**, **novo**, **alterado** ou **removido**.
- Planos de anos anteriores não mudam.

## 4. Ajuste mensal que altera o anual

**Inconsistência resolvida:** um mensal que altera o anual pode desatualizar outros meses e diários.

Regra:
1. O professor marca conteúdos a mais ou a menos no mês.
2. O sistema gera a versão do mensal e uma **prévia** das mudanças no anual.
3. Só após confirmação o anual recebe **nova versão** (`versao + 1`).
4. Meses e diários ligados aos itens alterados ficam com status **desatualizado**, e o sistema oferece regenerar.

## 5. Conteúdo não trabalhado

Quando um conteúdo planejado não é dado no mês, o professor escolhe:
- **Replanejar** para o mês seguinte (o item passa para o próximo mensal), ou
- **Registrar** apenas (fica como não trabalhado no histórico).

## 6. Aulas

- `aulas_semana` fica no vínculo turma x disciplina (`turma_disciplinas`).
- Aulas no ano = aulas por semana x dias letivos da disciplina no ano, com o cálculo feito por semana letiva.
- Aulas por dia: distribuídas pelos dias da semana conforme os horários cadastrados.

**Pendência técnica:** definir se a grade de horários por dia da semana é cadastrada (ex.: seg 2 aulas, qua 1 aula) ou se a distribuição é uniforme. Se for uniforme, a soma pode não bater com o total. Hoje assumido: grade cadastrada.

## 7. Calendário e eventos

- Tipos: feriado nacional, feriado estadual, feriado municipal, ponto facultativo, recesso, evento do colégio, ação pedagógica.
- Campo `dia_letivo` define se o dia gera plano diário.
- Campo `todos_colegios` define se o evento vale para todos. Caso contrário, vale para os colégios escolhidos (seleção múltipla).
- Feriados nacionais são importados da BrasilAPI. Os demais são cadastrados.

## 8. Alunos

Quantidade de alunos é só dado do cabeçalho. Não altera o conteúdo gerado.

## 9. Validações

- Um anual não pode ser duplicado para o mesmo ano, colégio, turma e disciplina.
- Soma de dias letivos do ano diferente de 200: aviso no painel, sem bloqueio.
- Mensal não pode ser gerado para mês sem dias letivos.
- Diário não pode ser gerado para dia que não é letivo.
- Ao remover um conteúdo do anual, os meses que o usam ficam como desatualizados.

## 10. Segurança e dados

- Todas as tabelas têm RLS por usuário.
- Chaves de API ficam em segredos do Supabase.
- Dados de colégios (emails de direção, coordenação e supervisão) ficam só no banco, nunca no repositório.
