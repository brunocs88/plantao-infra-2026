import { config } from './config.js';

/**
 * Libera/derruba o cliente no equipamento de rede (CoovaChilli, MikroTik hotspot,
 * UniFi, pfSense...). Modo "log" apenas registra; "webhook" faz POST JSON para um
 * script/serviço seu que fala com o equipamento.
 */
export async function authorizeClient({ mac, ip, ap, sessionId, seconds }) {
  if (config.gatewayMode === 'webhook' && config.gatewayWebhookUrl) {
    const res = await fetch(config.gatewayWebhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'authorize', mac, ip, ap, sessionId, seconds }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`gateway respondeu ${res.status}`);
    return;
  }
  console.log(`[gateway:log] authorize mac=${mac} ip=${ip} seconds=${seconds}`);
}

export async function notifyOtp(user, code) {
  // Troque por envio real de e-mail/SMS. Em dev apenas imprime.
  console.log(`[otp] para ${user.email || user.phone}: ${code}`);
}
