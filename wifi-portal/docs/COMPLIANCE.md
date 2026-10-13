# Conformidade: LGPD (Lei 13.709/2018) e Marco Civil (Lei 12.965/2014)

> Documento técnico, **não é parecer jurídico**. Valide com seu advogado/DPO antes de operar.

## ⚠️ Atenção: "captura de navegação"

Marco Civil, **art. 14**: *"Na provisão de conexão, onerosa ou gratuita, é vedado guardar os registros de acesso a aplicações de internet."*
Quem oferece Wi-Fi é, em regra, **provedor de conexão**. Logo:

- **Obrigatório guardar** (art. 13): registros de **conexão** — usuário, IP (+ porta de origem se NAT/CGNAT), data/hora de início e fim, MAC/AP — por **1 ano**, em ambiente controlado e sigiloso.
- **Vedado guardar** (art. 14): registro de **acesso a aplicações** (sites/apps acessados, URLs) *por provedor de conexão*. Há debate se estabelecimentos comerciais (hotéis, lojas) se enquadram, mas o risco é real, e a ANPD pode ainda considerar finalidade e necessidade (LGPD art. 6º).

Por isso este projeto:
- Mantém `NAV_LOGGING=off` por padrão. O registro de conexão (obrigação legal) funciona sempre.
- Quando ativado (`domain`), grava **só domínio** — nunca caminho, query, conteúdo — e **só com sessão identificada**, prazo curto (`NAV_RETENTION_DAYS`), eliminável pelo titular, usado para segurança e estatística agregada.
- **Não ative sem parecer jurídico** sobre seu enquadramento (provedor de conexão x aplicação) e sem registrar o teste de legítimo interesse (LIA) ou outra base legal. Não faça inspeção HTTPS (MITM) nem capture conteúdo.

## Mapa de requisitos → implementação

| Requisito | Onde |
|---|---|
| Guarda de conexão 1 ano, sigilo (MCI art. 13) | `conn_log`, `CONN_RETENTION_DAYS` (mínimo 365 forçado em `config.js`) |
| Porta de origem em CGNAT | `nat_port_start/end` (enviar em `/api/session/end`) |
| Integridade/evidência | Hash HMAC encadeado + `/admin/api/verify-chain` |
| Fornecimento só por ordem judicial (MCI art. 22) | `/admin/lookup` exige `ref` e grava em `audit` |
| Identificação do usuário | Nome, CPF validado (guardado como HMAC + máscara), e-mail confirmado por OTP |
| Base legal clara (LGPD art. 7º) | Cadastro/registro: obrigação legal (II); marketing: consentimento (I), separado e opcional |
| Consentimento comprovável (art. 8º) | `consents`: versão da política, hash SHA-256 do texto exato exibido, IP, user-agent, data |
| Finalidade/necessidade/minimização (art. 6º) | Sem rastreio de URL; telefone opcional; CPF não guardado em claro; relatórios mascaram CPF |
| Transparência (art. 9º) | `/privacy`, `/terms`, DPO exibido |
| Direitos do titular (art. 18) | `/titular` + `/admin/dsr` (acesso/portabilidade em JSON, revogação, eliminação) |
| Eliminação vs. obrigação legal (art. 16, I) | Eliminação remove navegação e marketing de imediato; identificação ligada ao log de conexão é retida e **anonimizada automaticamente** ao fim do prazo |
| Limitação de prazo (art. 15/16) | `runRetention` na partida e a cada 6h |
| Segurança (art. 46) | Basic Auth admin com comparação em tempo constante, rate limit, CSP, escape de HTML, limite de corpo, sem SQL concatenado, auditoria |
| Prestação de contas (art. 37/6º X) | Tabela `audit` (exports, lookups, DSR, retenção) |

## Pendências para produção (fora do escopo do código)

1. **HTTPS** no portal e no admin (proxy reverso); restrinja `/admin` por rede/VPN. Considere SSO/2FA no lugar de Basic Auth.
2. **Cifrar** disco/backup do banco; chaves (`APP_SECRET`) em cofre. Trocar `APP_SECRET` invalida a verificação da cadeia e o hash de CPF — não rotacione sem migração.
3. **NTP** nos equipamentos e servidor; timestamps são UTC (ISO 8601). Exporte para custódia externa (WORM) periodicamente se quiser força probatória maior.
4. **Envio real de OTP** (SMTP/SMS) em `gateway.js`. CPF é autodeclarado; o OTP só prova controle do e-mail. Para maior assertividade, use gov.br / validação por documento.
5. Menores de idade (LGPD art. 14): decidir bloqueio ou consentimento parental conforme público do local.
6. **RIPD/DPIA**, registro das operações de tratamento (art. 37), contrato com operadores, plano de resposta a incidentes (comunicação à ANPD, art. 48) e designação do encarregado.
7. Texto da política (`views.js`) e prazos devem refletir a sua realidade; aumente `POLICY_VERSION` ao alterar — novos aceites passam a registrar a nova versão.
