import { getSessao, aoMudarSessao, entrarComGoogle, entrarComSenha, sair } from './auth.js';
import { mostrarErro, carregando } from './ui.js';
import { telaPainel, sairDoPainel } from './painel.js';
import { telaCalendario } from './calendario.js';
import { telaPlanos } from './planos.js';
import { telaMateriais } from './materiais.js';
import { telaCadastro } from './cadastros.js';
import { telaConfiguracoes } from './configuracoes.js';

const ROTAS = {
  painel: telaPainel,
  calendario: telaCalendario,
  planos: telaPlanos,
  materiais: telaMateriais,
  colegios: (main) => telaCadastro(main, 'colegios'),
  turmas: (main) => telaCadastro(main, 'turmas'),
  disciplinas: (main) => telaCadastro(main, 'disciplinas'),
  aulas: (main) => telaCadastro(main, 'aulas'),
  configuracoes: telaConfiguracoes
};

const login = document.getElementById('login');
const app = document.getElementById('app');
const main = document.getElementById('main');
let logado = false;

function rotaAtual() {
  const nome = (location.hash.replace(/^#\/?/, '') || 'painel').split('?')[0];
  return ROTAS[nome] ? nome : 'painel';
}

async function rotear() {
  if (!logado) return;
  const nome = rotaAtual();
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('ativo', a.dataset.rota === nome));
  sairDoPainel();
  main.innerHTML = carregando();
  try {
    await ROTAS[nome](main);
  } catch (err) {
    mostrarErro(err);
  }
  window.scrollTo({ top: 0 });
}

function mostrarLogin(mensagem) {
  logado = false;
  app.hidden = true;
  login.hidden = false;
  const erro = document.getElementById('login-erro');
  erro.hidden = !mensagem;
  erro.textContent = mensagem || '';
}

function mostrarApp(sessao) {
  logado = true;
  login.hidden = true;
  app.hidden = false;
  document.getElementById('usuario-email').textContent = sessao.user?.email || '';
  if (!location.hash || location.hash === '#') location.hash = '#/painel';
  rotear();
}

document.getElementById('btn-entrar').addEventListener('click', () => {
  entrarComGoogle().catch((err) => mostrarLogin(err.message));
});

// TEMPORÁRIO: remover junto com o formulário de senha no index.html.
document.getElementById('form-senha').addEventListener('submit', async (e) => {
  e.preventDefault();
  const { error } = await entrarComSenha(
    document.getElementById('senha-email').value.trim(),
    document.getElementById('senha-valor').value
  );
  if (error) mostrarLogin('E-mail ou senha incorretos.');
});

document.getElementById('btn-sair').addEventListener('click', async () => {
  await sair();
  mostrarLogin('');
});

window.addEventListener('hashchange', rotear);

aoMudarSessao((sessao) => {
  if (sessao) mostrarApp(sessao);
  else mostrarLogin('');
});

(async () => {
  const params = new URLSearchParams(location.search);
  const erroUrl = params.get('error_description') || params.get('error');
  const sessao = await getSessao();
  if (sessao) mostrarApp(sessao);
  else mostrarLogin(erroUrl ? `Não foi possível entrar: ${erroUrl}` : '');
})();
