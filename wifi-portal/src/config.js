const env = process.env;
const int = (v, d) => (Number.isFinite(parseInt(v, 10)) ? parseInt(v, 10) : d);

export const config = {
  port: int(env.PORT, 8080),
  dbPath: env.DB_PATH || './data/wifi.db',
  secret: env.APP_SECRET || 'dev-secret-inseguro',
  adminUser: env.ADMIN_USER || 'admin',
  adminPassword: env.ADMIN_PASSWORD || 'admin',
  ingestToken: env.INGEST_TOKEN || '',
  org: {
    name: env.ORG_NAME || 'Minha Empresa Ltda',
    cnpj: env.ORG_CNPJ || '00.000.000/0001-00',
    dpoName: env.DPO_NAME || 'Encarregado de Dados',
    dpoEmail: env.DPO_EMAIL || 'privacidade@example.com.br',
  },
  policyVersion: env.POLICY_VERSION || '2026-10-13',
  // Marco Civil, art. 13: mínimo de 1 ano. Nunca abaixo disso.
  connRetentionDays: Math.max(365, int(env.CONN_RETENTION_DAYS, 365)),
  navLogging: env.NAV_LOGGING === 'domain' ? 'domain' : 'off',
  navRetentionDays: int(env.NAV_RETENTION_DAYS, 180),
  syslogPort: int(env.SYSLOG_UDP_PORT, 0),
  gatewayMode: env.GATEWAY_MODE || 'log',
  gatewayWebhookUrl: env.GATEWAY_WEBHOOK_URL || '',
  otpTtlMinutes: int(env.OTP_TTL_MINUTES, 10),
  // 1 = confia em mac/ip enviados pelo gateway no redirect (use só com redirect assinado/rede isolada)
  trustGatewayParams: env.TRUST_GATEWAY_PARAMS === '1',
  sessionHours: int(env.SESSION_HOURS, 8),
};
