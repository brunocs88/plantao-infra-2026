import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.STORAGE_URL,
  token: process.env.STORAGE_TOKEN,
});

// GET  → devolve as trocas salvas
// POST → valida credenciais e salva as trocas
export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const data = await redis.get('plantao-overrides');
      return res.status(200).json(data || {});
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

      const body = req.body;
      await redis.set('plantao-overrides', body);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'Erro interno: ' + (err instanceof Error ? err.message : String(err)) });
  }
}
