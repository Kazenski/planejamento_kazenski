import { msgErro } from './db.js';

export function esc(valor) {
  return String(valor ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function el(html) {
  const modelo = document.createElement('template');
  modelo.innerHTML = html.trim();
  return modelo.content.firstElementChild;
}

export function toast(mensagem, tipo = '') {
  const area = document.getElementById('toast');
  area.textContent = mensagem;
  area.className = `toast ${tipo}`;
  area.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { area.hidden = true; }, 3800);
}

export function mostrarErro(err) {
  toast(msgErro(err), 'erro');
}

export function carregando(texto = 'Carregando...') {
  return `<p class="carregando">${esc(texto)}</p>`;
}

// Modal genérico. `conteudo` é um elemento DOM. `onSubmit` é opcional (sem ele, o modal é só leitura).
export function abrirModal({ titulo, conteudo, submitLabel = 'Salvar', onSubmit, acoesExtras = [], grande = false }) {
  const dlg = document.getElementById('dlg');
  const form = document.getElementById('dlg-form');
  document.getElementById('dlg-titulo').textContent = titulo;
  const corpo = document.getElementById('dlg-corpo');
  corpo.replaceChildren(conteudo);

  const extra = document.getElementById('dlg-extra');
  extra.replaceChildren(...acoesExtras.map((a) => {
    const b = el(`<button type="button" class="btn pequeno ${a.classe || ''}">${esc(a.label)}</button>`);
    b.addEventListener('click', () => a.onClick(fecharModal));
    return b;
  }));

  const salvar = document.getElementById('dlg-salvar');
  salvar.textContent = submitLabel;
  salvar.hidden = !onSubmit;
  form.classList.toggle('so-leitura', !onSubmit);

  dlg.classList.toggle('grande', grande);
  form.onsubmit = async (e) => {
    e.preventDefault();
    if (!onSubmit) return;
    salvar.disabled = true;
    try {
      await onSubmit(fecharModal);
    } catch (err) {
      mostrarErro(err);
    } finally {
      salvar.disabled = false;
    }
  };
  document.getElementById('dlg-cancelar').onclick = fecharModal;
  document.getElementById('dlg-x').onclick = fecharModal;
  dlg.showModal();
  return fecharModal;
}

export function fecharModal() {
  document.getElementById('dlg').close();
}

// Gera campos de formulário. Tipos: text, number, date, textarea, select, checks (múltipla escolha), bool, lista.
// Retorna { el, ler(): objeto com os valores }.
export function formulario(campos, valores = {}) {
  const grid = document.createElement('div');
  grid.className = 'campos-grid';
  const leitores = {};

  for (const c of campos) {
    const v = valores[c.k];
    const largo = c.largo ? ' largo' : '';
    let bloco;

    if (c.type === 'bool') {
      bloco = el(`<label class="campo linha ${largo}"><input type="checkbox" name="${c.k}" ${v ? 'checked' : ''}><span>${esc(c.label)}</span></label>`);
      leitores[c.k] = () => bloco.querySelector('input').checked;
    } else if (c.type === 'checks') {
      const sel = new Set(v || []);
      const opcoes = c.opcoes.map(([val, rot]) =>
        `<label><input type="checkbox" value="${esc(val)}" ${sel.has(val) ? 'checked' : ''}>${esc(rot)}</label>`).join('');
      bloco = el(`<div class="campo ${largo}"><span>${esc(c.label)}</span><div class="checks">${opcoes || '<span class="muted small">Nada cadastrado ainda.</span>'}</div>${c.ajuda ? `<span class="ajuda">${esc(c.ajuda)}</span>` : ''}</div>`);
      leitores[c.k] = () => [...bloco.querySelectorAll('input:checked')].map((i) => i.value);
    } else if (c.type === 'select') {
      const opcoes = (c.opcoes || []).map(([val, rot]) =>
        `<option value="${esc(val)}" ${String(val) === String(v ?? '') ? 'selected' : ''}>${esc(rot)}</option>`).join('');
      bloco = el(`<label class="campo ${largo}"><span>${esc(c.label)}</span><select name="${c.k}" ${c.req ? 'required' : ''}>${c.vazio ? `<option value="">${esc(c.vazio)}</option>` : ''}${opcoes}</select>${c.ajuda ? `<span class="ajuda">${esc(c.ajuda)}</span>` : ''}</label>`);
      leitores[c.k] = () => bloco.querySelector('select').value || null;
    } else if (c.type === 'textarea' || c.type === 'lista') {
      const texto = c.type === 'lista' ? (v || []).join('\n') : (v ?? '');
      bloco = el(`<label class="campo ${largo}"><span>${esc(c.label)}</span><textarea name="${c.k}" ${c.req ? 'required' : ''} placeholder="${esc(c.placeholder || '')}">${esc(texto)}</textarea>${c.ajuda ? `<span class="ajuda">${esc(c.ajuda)}</span>` : ''}</label>`);
      const area = bloco.querySelector('textarea');
      leitores[c.k] = () => (c.type === 'lista'
        ? area.value.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean)
        : (area.value.trim() || null));
    } else {
      const tipo = c.type || 'text';
      const valorAtual = v ?? '';
      bloco = el(`<label class="campo ${largo}"><span>${esc(c.label)}</span><input type="${tipo}" name="${c.k}" value="${esc(valorAtual)}" ${c.req ? 'required' : ''} ${c.min !== undefined ? `min="${c.min}"` : ''} ${c.max !== undefined ? `max="${c.max}"` : ''} ${c.step ? `step="${c.step}"` : ''} placeholder="${esc(c.placeholder || '')}">${c.ajuda ? `<span class="ajuda">${esc(c.ajuda)}</span>` : ''}</label>`);
      const input = bloco.querySelector('input');
      leitores[c.k] = () => {
        const val = input.value.trim();
        if (tipo === 'number') return val === '' ? null : Number(val);
        return val === '' ? null : val;
      };
    }
    grid.appendChild(bloco);
  }

  return {
    el: grid,
    ler() {
      const out = {};
      for (const k of Object.keys(leitores)) out[k] = leitores[k]();
      return out;
    }
  };
}

export function tagStatus(status, mapa = {}) {
  const cores = { rascunho: '', gerado: 'azul', aprovado: 'verde', desatualizado: 'perigo' };
  const rotulo = mapa[status] || status;
  return `<span class="tag ${cores[status] || ''}">${esc(rotulo)}</span>`;
}

export function fmtData(iso) {
  if (!iso) return '';
  const [a, m, d] = String(iso).slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
}

export function lista(itens) {
  return (itens || []).length ? itens.join(', ') : '<span class="muted">—</span>';
}
