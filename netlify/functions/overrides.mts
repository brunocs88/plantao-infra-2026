import type { Context, Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

// Confere usuário e senha de administrador antes de salvar qualquer troca.
export default async (req: Request, context: Context) => {
  const store = getStore("plantao-overrides");

  if (req.method === "GET") {
    const data = await store.get("overrides", { type: "json" });
    return new Response(JSON.stringify(data || {}), {
      headers: { "Content-Type": "application/json" }
    });
  }

  if (req.method === "POST") {
    const adminUser = req.headers.get("x-admin-user");
    const adminKey = req.headers.get("x-admin-key");
    const expectedUser = Netlify.env.get("ADMIN_USER");
    const expectedKey = Netlify.env.get("ADMIN_KEY");

    if (!expectedUser || !expectedKey || adminUser !== expectedUser || adminKey !== expectedKey) {
      return new Response(JSON.stringify({ ok: false, error: "usuário ou senha incorretos" }), {
        status: 401,
        headers: { "Content-Type": "application/json" }
      });
    }

    const body = await req.json();
    await store.setJSON("overrides", body);
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" }
    });
  }

  return new Response("Method not allowed", { status: 405 });
};

export const config: Config = {
  path: "/api/overrides"
};
