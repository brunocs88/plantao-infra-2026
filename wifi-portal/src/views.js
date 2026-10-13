import { esc } from './util.js';
import { config } from './config.js';
import { sha256 } from './util.js';

const CSS = `*{box-sizing:border-box}body{font-family:system-ui,sans-serif;margin:0;background:#f3f5f9;color:#1b2430}
main{max-width:480px;margin:0 auto;padding:20px}h1{font-size:1.4rem}.card{background:#fff;border-radius:12px;padding:20px;box-shadow:0 1px 4px #0002}
label{display:block;margin:12px 0 4px;font-weight:600;font-size:.9rem}input[type=text],input[type=email],input[type=tel],input[type=password]{width:100%;padding:12px;border:1px solid #bcc5d3;border-radius:8px;font-size:1rem}
.chk{display:flex;gap:10px;align-items:flex-start;margin:12px 0;font-weight:400}.chk input{margin-top:4px;width:20px;height:20px;flex:none}
button{width:100%;padding:14px;border:0;border-radius:8px;background:#0b63ce;color:#fff;font-size:1rem;font-weight:700;margin-top:16px}
.err{background:#fde8e8;color:#8a1c1c;padding:10px;border-radius:8px;margin-bottom:12px}.small{font-size:.8rem;color:#55627a}a{color:#0b63ce}
table{border-collapse:collapse;width:100%;font-size:.85rem}td,th{border-bottom:1px solid #dde3ec;padding:6px;text-align:left}`;

export const page = (title, body, wide = false) => `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${CSS}${wide ? 'main{max-width:1000px}' : ''}</style></head>
<body><main>${body}</main></body></html>`;

// Textos de consentimento: o hash do texto exato exibido é gravado junto do aceite (prova do que foi aceito).
export const CONSENT_TEXT = {
  terms: `Li e aceito os Termos de Uso da rede Wi-Fi.`,
  privacy: `Estou ciente de que ${config.org.name} tratará meus dados de identificação (nome, CPF, e-mail) e de conexão (IP, MAC, data e hora de acesso) para identificar usuários, garantir a segurança da rede e cumprir obrigação legal de guarda de registros pelo prazo mínimo de 1 ano (Lei 12.965/2014, art. 13), conforme a Política de Privacidade.`,
  marketing: `(Opcional) Aceito receber comunicações e ofertas de ${config.org.name} por e-mail.`,
};
export const consentHash = (kind) => sha256(`${config.policyVersion}|${CONSENT_TEXT[kind]}`);

export function portalPage({ params, error = '', values = {} }) {
  const hidden = ['mac', 'ip', 'ap', 'url'].map((k) => `<input type="hidden" name="${k}" value="${esc(params[k] || '')}">`).join('');
  const v = (k) => esc(values[k] || '');
  return page('Wi-Fi - Acesso', `
<h1>Acesse o Wi-Fi</h1><div class="card">
${error ? `<div class="err" role="alert">${esc(error)}</div>` : ''}
<form method="post" action="/register">${hidden}
<label for="name">Nome completo</label><input id="name" name="name" type="text" required autocomplete="name" value="${v('name')}">
<label for="cpf">CPF</label><input id="cpf" name="cpf" type="text" inputmode="numeric" required maxlength="14" value="${v('cpf')}">
<label for="email">E-mail</label><input id="email" name="email" type="email" required autocomplete="email" value="${v('email')}">
<label for="phone">Celular (opcional)</label><input id="phone" name="phone" type="tel" autocomplete="tel" value="${v('phone')}">
<label class="chk"><input type="checkbox" name="terms" value="1" required><span>${esc(CONSENT_TEXT.terms)} <a href="/terms" target="_blank">Termos</a></span></label>
<label class="chk"><input type="checkbox" name="privacy" value="1" required><span>${esc(CONSENT_TEXT.privacy)} <a href="/privacy" target="_blank">Política de Privacidade</a></span></label>
<label class="chk"><input type="checkbox" name="marketing" value="1"><span>${esc(CONSENT_TEXT.marketing)}</span></label>
<button type="submit">Receber código</button></form></div>
<p class="small">Seus direitos como titular: <a href="/titular">solicitar acesso, correção ou eliminação</a>.</p>`);
}

export const otpPage = ({ userId, params, error = '' }) => page('Confirmar código', `
<h1>Confirme seu e-mail</h1><div class="card">${error ? `<div class="err">${esc(error)}</div>` : ''}
<p>Enviamos um código de 6 dígitos para o e-mail informado.</p>
<form method="post" action="/verify"><input type="hidden" name="uid" value="${esc(userId)}">
${['mac', 'ip', 'ap', 'url'].map((k) => `<input type="hidden" name="${k}" value="${esc(params[k] || '')}">`).join('')}
<label for="code">Código</label><input id="code" name="code" type="text" inputmode="numeric" maxlength="6" required autocomplete="one-time-code">
<button type="submit">Conectar</button></form></div>`);

export const connectedPage = (url) => page('Conectado', `<h1>Conectado!</h1><div class="card"><p>Você já pode navegar.</p>
${url ? `<p><a href="${esc(url)}" rel="noreferrer">Continuar</a></p>` : ''}</div>`);

export const privacyPage = () => page('Política de Privacidade', `<h1>Política de Privacidade</h1><div class="card">
<p><b>Controlador:</b> ${esc(config.org.name)} (CNPJ ${esc(config.org.cnpj)}).<br>
<b>Encarregado (DPO):</b> ${esc(config.org.dpoName)} - <a href="mailto:${esc(config.org.dpoEmail)}">${esc(config.org.dpoEmail)}</a>.<br>
<b>Versão:</b> ${esc(config.policyVersion)}</p>
<h3>Dados coletados e finalidades</h3><ul>
<li><b>Identificação</b> (nome, CPF, e-mail, celular): identificar o usuário da rede e cumprir obrigação legal (LGPD art. 7º, II).</li>
<li><b>Registros de conexão</b> (IP, porta de origem quando houver NAT, MAC, ponto de acesso, início e fim): guarda obrigatória de ${config.connRetentionDays} dias, sob sigilo, fornecida somente mediante ordem judicial (Marco Civil, arts. 13 e 22).</li>
${config.navLogging === 'domain' ? `<li><b>Domínios acessados</b> (sem conteúdo, sem caminho de página): segurança da rede e estatísticas agregadas; guardados por ${config.navRetentionDays} dias.</li>` : '<li>Não coletamos os sites ou aplicativos que você acessa.</li>'}
<li><b>Marketing</b>: somente se você marcar a opção específica; pode revogar a qualquer momento.</li></ul>
<h3>Compartilhamento</h3><p>Não vendemos dados. Compartilhamos apenas por ordem judicial ou com operadores contratados para a operação da rede.</p>
<h3>Seus direitos (LGPD art. 18)</h3><p>Confirmação, acesso, correção, anonimização, portabilidade, eliminação dos dados tratados com consentimento, informação sobre compartilhamento e revogação do consentimento: <a href="/titular">/titular</a> ou ${esc(config.org.dpoEmail)}. Dados de registro de conexão não podem ser eliminados antes do prazo legal.</p></div>`);

export const termsPage = () => page('Termos de Uso', `<h1>Termos de Uso</h1><div class="card">
<p>O acesso é pessoal e intransferível. Você é responsável pelo uso feito com suas credenciais. É proibido uso ilícito, envio de spam, ataques a terceiros e violação de direitos autorais.
Os registros de conexão são mantidos e poderão ser fornecidos à autoridade competente por ordem judicial. O acesso pode ser suspenso em caso de abuso.</p></div>`);

export const titularPage = ({ msg = '', error = '' } = {}) => page('Direitos do titular', `<h1>Direitos do titular</h1><div class="card">
${msg ? `<p>${esc(msg)}</p>` : ''}${error ? `<div class="err">${esc(error)}</div>` : ''}
<form method="post" action="/titular"><label for="email">E-mail cadastrado</label><input id="email" name="email" type="email" required>
<label for="kind">Solicitação</label><select id="kind" name="kind" style="width:100%;padding:12px">
<option value="acesso">Acesso / cópia dos meus dados</option><option value="correcao">Correção</option>
<option value="eliminacao">Eliminação / revogar consentimento</option><option value="revogar_marketing">Revogar marketing</option></select>
<button type="submit">Enviar solicitação</button></form>
<p class="small">Por segurança, o atendimento é confirmado pelo encarregado por meio do e-mail cadastrado. Prazo de resposta: 15 dias.</p></div>`);
