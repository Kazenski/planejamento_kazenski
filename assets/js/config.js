// Chaves públicas do projeto. A chave publicável é segura no front-end porque o RLS protege os dados.
// Nunca colocar aqui a service_role, o token sbp_ nem a chave da IA.
export const SUPABASE_URL = 'https://sqqtcshgfriwinpvvszp.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_WMn_9QyZsI4dk7eihcBDow_tPK5JP4a';

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
export const SCOPES_LOGIN = 'openid email profile';

export const DIAS_LETIVOS_PADRAO = 200;
export const URL_FERIADOS = 'https://brasilapi.com.br/api/feriados/v1/';

export const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
export const MESES_PLANEJAMENTO = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
export const DIAS_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

export const SERIES = { 1: '1º ano', 2: '2º ano', 3: '3º ano' };

export const TIPOS_EVENTO = {
  feriado_nacional: 'Feriado nacional',
  feriado_estadual: 'Feriado estadual',
  feriado_municipal: 'Feriado municipal',
  ponto_facultativo: 'Ponto facultativo',
  recesso: 'Recesso',
  evento_colegio: 'Evento do colégio',
  acao_pedagogica: 'Ação pedagógica'
};

export const STATUS_PLANO = { rascunho: 'Rascunho', gerado: 'Gerado', aprovado: 'Aprovado', desatualizado: 'Desatualizado' };
