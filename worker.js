import { Redis } from '@upstash/redis';

function getRedis(env) {
  return new Redis({ url: env.KV_REST_API_URL, token: env.KV_REST_API_TOKEN });
}

function checkAdmin(request, env) {
  const adminUser = request.headers.get('x-admin-user');
  const adminKey = request.headers.get('x-admin-key');
  if (!env.ADMIN_USER || !env.ADMIN_KEY) {
    return { ok: false, status: 500, error: 'Variáveis ADMIN_USER/ADMIN_KEY não configuradas no servidor.' };
  }
  if (adminUser !== env.ADMIN_USER || adminKey !== env.ADMIN_KEY) {
    return { ok: false, status: 401, error: 'Usuário ou senha incorretos.' };
  }
  return { ok: true };
}

async function handleSchedule(request, env) {
  const redis = getRedis(env);
  if (request.method === 'GET') {
    const schedules = await redis.get('plantao-schedules');
    return Response.json(schedules || {});
  }
  if (request.method === 'POST') {
    const auth = checkAdmin(request, env);
    if (!auth.ok) return Response.json({ ok: false, error: auth.error }, { status: auth.status });

    const { year, data, holidays } = await request.json();
    if (!year || !/^\d{4}$/.test(String(year))) {
      return Response.json({ ok: false, error: 'Ano inválido.' }, { status: 400 });
    }
    if (!Array.isArray(data) || data.length === 0) {
      return Response.json({ ok: false, error: 'Nenhum plantão encontrado para salvar.' }, { status: 400 });
    }

    const schedules = (await redis.get('plantao-schedules')) || {};
    schedules[String(year)] = { data, holidays: holidays || {} };
    await redis.set('plantao-schedules', schedules);
    return Response.json({ ok: true });
  }
  return new Response('Method not allowed', { status: 405 });
}

async function handleOverrides(request, env) {
  const redis = getRedis(env);
  if (request.method === 'GET') {
    const data = await redis.get('plantao-overrides');
    return Response.json(data || {});
  }
  if (request.method === 'POST') {
    const auth = checkAdmin(request, env);
    if (!auth.ok) return Response.json({ ok: false, error: auth.error }, { status: auth.status });

    const body = await request.json();
    await redis.set('plantao-overrides', body);
    return Response.json({ ok: true });
  }
  return new Response('Method not allowed', { status: 405 });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    try {
      if (url.pathname === '/api/schedule') return await handleSchedule(request, env);
      if (url.pathname === '/api/overrides') return await handleOverrides(request, env);
    } catch (err) {
      return Response.json({ ok: false, error: 'Erro interno: ' + (err instanceof Error ? err.message : String(err)) }, { status: 500 });
    }
    return env.ASSETS.fetch(request);
  },
};
