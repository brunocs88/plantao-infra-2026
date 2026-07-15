import type { Context, Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

export default async (req: Request, context: Context) => {
  const store = getStore("plantao-overrides");

  if (req.method === "GET") {
    const data = await store.get("overrides", { type: "json" });
    return new Response(JSON.stringify(data || {}), {
      headers: { "Content-Type": "application/json" }
    });
  }

  if (req.method === "POST") {
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
