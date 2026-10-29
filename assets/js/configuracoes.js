import { getConfig, setConfig } from './db.js';
import { esc, toast, mostrarErro, carregando } from './ui.js';
import { DIAS_LETIVOS_PADRAO } from './config.js';

export async function telaConfiguracoes(main) {
  main.innerHTML = `
    <div class="pagina-cabecalho">
      <div>
        <h1>Configurações</h1>
        <p>Regras gerais que valem para todos os colégios.</p>
      </div>
    </div>
    <div id="cfg">${carregando()}</div>`;

  let meta;
  try {
    meta = await getConfig('dias_letivos_ano', DIAS_LETIVOS_PADRAO);
  } catch (err) {
    mostrarErro(err);
    return;
  }

  document.getElementById('cfg').innerHTML = `
    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(360px,1fr))">
      <div class="card">
        <h3>Dias letivos por ano</h3>
        <p class="small muted">Meta usada no calendário e no painel. A LDB (art. 24) prevê 200 dias de efetivo trabalho escolar. Altere só se o sistema de ensino mudar.</p>
        <form id="form-meta" class="acoes" style="margin-top:12px">
          <label class="campo"><span>Dias letivos</span>
            <input id="cfg-meta" type="number" min="1" max="260" step="1" value="${esc(meta)}" required style="width:140px">
          </label>
          <button class="btn primary" type="submit" style="align-self:flex-end">Salvar</button>
        </form>
      </div>

      <div class="card">
        <h3>Regras de planejamento</h3>
        <ul style="margin:0 0 0 18px;padding:0">
          <li>Meses de planejamento: fevereiro a dezembro. Janeiro não tem plano.</li>
          <li>Trimestres: 1º fev–abr, 2º mai–ago, 3º set–dez.</li>
          <li>Dia útil é letivo, exceto feriado ou evento marcado como sem aula.</li>
          <li>Plano diário só existe para dia letivo.</li>
          <li>O plano anual é a fonte da verdade. Mensal e diário são recortes dele.</li>
          <li>Quantidade de alunos aparece só no cabeçalho do plano.</li>
        </ul>
      </div>
    </div>`;

  document.getElementById('form-meta').addEventListener('submit', async (e) => {
    e.preventDefault();
    const valor = Number(document.getElementById('cfg-meta').value);
    if (!Number.isInteger(valor) || valor < 1) return toast('Informe um número inteiro de dias.', 'erro');
    try {
      await setConfig('dias_letivos_ano', valor);
      toast('Meta de dias letivos salva.', 'ok');
    } catch (err) { mostrarErro(err); }
  });
}
