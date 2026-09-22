import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

// GET  → devolve { "<ano>": { data, holidays }, ... } com todos os anos
//        de escala importados via planilha (o ano embutido 2026 não fica
//        aqui — ele já vem no HTML e só é sobrescrito se o admin reenviar).
// POST → valida credenciais e substitui por completo a escala de UM ano,
//        { year, data, holidays }.
export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const schedules = await redis.get('plantao-schedules');
      return res.status(200).json(schedules || {});
    }

    if (req.method === 'POST') {
      const adminUser = req.headers['x-admin-user'];
      const adminKey  = req.headers['x-admin-key'];
      const expectedUser = process.env.ADMIN_USER;
      const expectedKey  = process.env.ADMIN_KEY;

      if (!expectedUser || !expectedKey) {
        return res.status(500).json({ ok: false, error: 'Variáveis ADMIN_USER/ADMIN_KEY não configuradas no servidor.' });
      }
      if (adminUser !== expectedUser || adminKey !== expectedKey) {
        return res.status(401).json({ ok: false, error: 'Usuário ou senha incorretos.' });
      }

      const { year, data, holidays } = req.body || {};
      if (!year || !/^\d{4}$/.test(String(year))) {
        return res.status(400).json({ ok: false, error: 'Ano inválido.' });
      }
      if (!Array.isArray(data) || data.length === 0) {
        return res.status(400).json({ ok: false, error: 'Nenhum plantão encontrado para salvar.' });
      }

      const schedules = (await redis.get('plantao-schedules')) || {};
      schedules[String(year)] = { data, holidays: holidays || {} };
      await redis.set('plantao-schedules', schedules);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'Erro interno: ' + (err instanceof Error ? err.message : String(err)) });
  }
}
