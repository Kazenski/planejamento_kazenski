// Regras de calendário e de aulas. Sem acesso ao banco: recebem dados e devolvem resultados.
// Datas em texto 'AAAA-MM-DD'. Cálculos em UTC para não sofrer com fuso horário.

export function ymd(ano, mes, dia) {
  return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

export function diaSemanaDe(dataTexto) {
  const [a, m, d] = dataTexto.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d)).getUTCDay(); // 0 = domingo
}

export function ehDiaUtil(dataTexto) {
  const s = diaSemanaDe(dataTexto);
  return s >= 1 && s <= 5;
}

export function diasDoMes(ano, mes) {
  const total = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return Array.from({ length: total }, (_, i) => ymd(ano, mes, i + 1));
}

export function diasDoAno(ano) {
  const out = [];
  for (let m = 1; m <= 12; m++) out.push(...diasDoMes(ano, m));
  return out;
}

// Um evento se aplica ao colégio se valer para todos ou se o colégio estiver na lista.
// Espera: { todos_colegios, colegios: [id, ...] }
export function eventoAplica(evento, colegioId) {
  if (evento.todos_colegios) return true;
  return colegioId != null && (evento.colegios || []).includes(colegioId);
}

// Regra: dia útil é letivo, a menos que um evento aplicável diga o contrário.
// Evento com dia_letivo = true força aula (ex.: sábado letivo). Evento com dia_letivo = false tira a aula.
export function classificarDia(dataTexto, eventos, colegioId) {
  const aplicaveis = eventos.filter((e) => e.data === dataTexto && eventoAplica(e, colegioId));
  const util = ehDiaUtil(dataTexto);
  let letivo = util;
  if (aplicaveis.some((e) => e.dia_letivo)) letivo = true;
  else if (aplicaveis.some((e) => !e.dia_letivo)) letivo = false;
  return { data: dataTexto, util, letivo, eventos: aplicaveis };
}

export function diasLetivos(datas, eventos, colegioId) {
  return datas.map((d) => classificarDia(d, eventos, colegioId)).filter((d) => d.letivo);
}

// Distribui as aulas da semana pelos dias letivos da mesma semana (segunda a domingo).
// Ex.: 2 aulas com 5 dias letivos => 2 dias com 1 aula; 5 aulas com 4 dias => 2, 1, 1, 1.
// Usa o ano inteiro para que semanas que atravessam dois meses sejam distribuídas corretamente.
export function aulasPorDia(letivosDoAno, aulasSemana) {
  const porSemana = new Map();
  for (const d of letivosDoAno) {
    const dt = new Date(d + 'T00:00:00Z');
    const dow = dt.getUTCDay();
    const segunda = new Date(dt);
    segunda.setUTCDate(dt.getUTCDate() - ((dow + 6) % 7));
    const chave = segunda.toISOString().slice(0, 10);
    if (!porSemana.has(chave)) porSemana.set(chave, []);
    porSemana.get(chave).push(d);
  }
  const resultado = new Map();
  for (const dias of porSemana.values()) {
    dias.sort();
    const n = dias.length;
    dias.forEach((d, i) => {
      const qtd = Math.floor(((i + 1) * aulasSemana) / n) - Math.floor((i * aulasSemana) / n);
      if (qtd > 0) resultado.set(d, qtd);
    });
  }
  return resultado;
}

// Categoria do dia para contagens e gráficos. Cada dia conta em uma categoria só.
// Fim de semana fica sem categoria (retorna null).
export function categoriaDia(classe) {
  if (!classe.util) return null;
  const tipos = classe.eventos.map((e) => e.tipo);
  if (tipos.some((t) => t.startsWith('feriado'))) return 'feriado';
  if (tipos.includes('recesso') || tipos.includes('ponto_facultativo')) return 'nao_letivo';
  if (tipos.includes('acao_pedagogica')) return 'pedagogica';
  if (tipos.includes('evento_colegio')) return 'evento';
  return classe.letivo ? 'letivo' : 'nao_letivo';
}

// Emenda: dia útil, sem feriado, em que o dia útil anterior ou o seguinte é feriado.
// Fins de semana são ignorados (ex.: feriado na segunda faz da sexta anterior uma emenda).
export function emendasDoAno(ano, eventos, colegioId) {
  const uteis = diasDoAno(ano).filter(ehDiaUtil);
  const feriados = new Set(uteis.filter((d) => classificarDia(d, eventos, colegioId).eventos.some((e) => e.tipo.startsWith('feriado'))));
  const emendas = new Set();
  uteis.forEach((d, i) => {
    if (feriados.has(d)) return;
    const anterior = uteis[i - 1];
    const seguinte = uteis[i + 1];
    if ((anterior && feriados.has(anterior)) || (seguinte && feriados.has(seguinte))) emendas.add(d);
  });
  return { feriados, emendas };
}

export function contarLetivos(letivos) {
  const porMes = {};
  for (const d of letivos) {
    const mes = Number(d.slice(5, 7));
    porMes[mes] = (porMes[mes] || 0) + 1;
  }
  return porMes;
}
