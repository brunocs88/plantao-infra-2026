# wifi-portal

Captive portal para Wi-Fi com identificação do usuário, consentimento LGPD, registro de conexão
(Marco Civil da Internet) e relatórios. Node >= 22.13, **sem dependências npm** (HTTP, SQLite e crypto nativos).

## Fluxo

1. O equipamento de rede (CoovaChilli, MikroTik Hotspot, UniFi, pfSense...) redireciona o cliente para `GET /?mac=..&ip=..&ap=..&url=..`.
2. Usuário informa nome, CPF (validado), e-mail e aceita Termos + Política (obrigatórios) e marketing (opcional, separado).
3. Código OTP por e-mail confirma o controle do contato (`src/gateway.js: notifyOtp` — hoje imprime no console; plugue SMTP/SMS).
4. Sessão é criada, evento `login` entra no **registro de conexão com hash encadeado** e o gateway é chamado para liberar o acesso.
5. O gateway avisa o fim da sessão em `POST /api/session/end` (Bearer `INGEST_TOKEN`), com faixa de portas NAT se houver CGNAT.
6. Opcional: DNS/proxy enviam domínios acessados por syslog UDP (dnsmasq, squid) ou `POST /api/nav`.

## Rodar

```
cd wifi-portal
cp .env.example .env   # edite segredos, razão social, DPO
npm start              # http://localhost:8080
npm test
```

## Endpoints

| Rota | Descrição |
|---|---|
| `/`, `/generate_204`, `/hotspot-detect.html`, `/connecttest.txt` | Portal (também atende detecção automática de captive portal) |
| `/privacy`, `/terms`, `/titular` | Política, termos e formulário de direitos do titular |
| `POST /api/session/end`, `POST /api/nav` | Integração (Bearer token) |
| `/admin` | Painel: sessões/dia, por AP, domínios, opt-in, integridade do log |
| `/admin/report.csv?type=sessions\|consents\|nav&from=&to=` | Exportação CSV (CPF mascarado, anti-injeção de fórmula) |
| `/admin/lookup?ip=&at=&ref=` | "Quem usava este IP neste instante" — exige nº do ofício/processo; auditado |
| `/admin/api/verify-chain` | Verifica a integridade do registro de conexão |
| `/admin/dsr` | Fila de solicitações de titulares (acesso, correção, eliminação, revogar marketing) |

## Integração com o equipamento

`GATEWAY_MODE=webhook` + `GATEWAY_WEBHOOK_URL` faz `POST {action:"authorize", mac, ip, ap, sessionId, seconds}`
para um script seu que chama a API do equipamento. `TRUST_GATEWAY_PARAMS=1` só deve ser usado se o redirect
for assinado ou a rede do portal for isolada; caso contrário o IP vem da conexão TCP (o portal precisa estar no caminho do cliente).

## Antes de produzir

Leia `docs/COMPLIANCE.md` (decisões jurídicas e pendências). Em resumo: HTTPS no portal (proxy reverso com TLS),
NTP sincronizado (fuso/UTC nos logs), segredos fora do repositório, backup **cifrado** do banco, e revisão jurídica.
