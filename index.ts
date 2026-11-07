// MinhaIA Knowledge API v1 - Supabase Edge Function (Deno)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8" },
});
const hex = (buffer: ArrayBuffer) => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
const hash = async (value: string) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const token = req.headers.get("x-api-key") || "";
  if (!token.startsWith("mia_")) return json({ error: "API key ausente ou inválida" }, 401);
  const keyHash = await hash(token);
  const { data: apiKey, error: keyError } = await admin.from("api_keys")
    .select("id,workspace_id,permissions,revoked_at").eq("key_hash", keyHash).maybeSingle();
  if (keyError || !apiKey || apiKey.revoked_at) return json({ error: "API key inválida ou revogada" }, 401);
  await admin.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", apiKey.id);

  const urlObj = new URL(req.url);
  const segments = urlObj.pathname.split("/").filter(Boolean);
  const resource = segments.at(-1) === "knowledge-api" ? "knowledge" : (segments.at(-1) || "knowledge");
  const recordId = segments.length > 1 ? segments.at(-1) : null;
  const canRead = apiKey.permissions.includes("read");
  const canWrite = apiKey.permissions.includes("write");
  const canDelete = apiKey.permissions.includes("delete");

  if (req.method === "GET") {
    if (!canRead) return json({ error: "Permissão read não concedida" }, 403);
    if (resource !== "knowledge" && resource !== "search") return json({ error: "Recurso não suportado" }, 404);
    let query = admin.from("knowledge_records").select("record_id,payload,updated_at")
      .eq("workspace_id", apiKey.workspace_id).eq("record_type", "knowledge").order("updated_at", { ascending: false }).limit(500);
    const q = urlObj.searchParams.get("q");
    if (q) query = query.ilike("payload->>title", `%${q.replace(/[%_]/g, "\\$&")}%`);
    const { data, error } = await query;
    if (error) return json({ error: error.message }, 500);
    return json({ data: (data || []).map((row) => ({ id: row.record_id, ...row.payload, updatedAt: row.updated_at })) });
  }

  if (req.method === "POST") {
    if (!canWrite) return json({ error: "Permissão write não concedida" }, 403);
    const body = await req.json().catch(() => null);
    if (!body || typeof body.title !== "string" || typeof body.content !== "string") return json({ error: "Envie title e content" }, 400);
    const id = crypto.randomUUID();
    const timestamp = new Date().toISOString();
    const payload = { id, title: body.title.slice(0, 180), content: body.content, summary: String(body.summary || ""), category: String(body.category || "Geral"), tags: Array.isArray(body.tags) ? body.tags.slice(0, 50) : [], agents: Array.isArray(body.agents) ? body.agents.slice(0, 50) : [], createdAt: timestamp, updatedAt: timestamp, source: "api", attachments: [] };
    const { error } = await admin.from("knowledge_records").insert({ workspace_id: apiKey.workspace_id, record_type: "knowledge", record_id: id, payload, updated_at: timestamp });
    if (error) return json({ error: error.message }, 500);
    return json({ data: payload }, 201);
  }

  if (req.method === "PATCH") {
    if (!canWrite) return json({ error: "Permissão write não concedida" }, 403);
    const body = await req.json().catch(() => null);
    const id = body?.id || urlObj.searchParams.get("id");
    if (!id || !body || typeof body !== "object") return json({ error: "Informe id e campos para atualizar" }, 400);
    const { data: current, error: readError } = await admin.from("knowledge_records").select("payload").eq("workspace_id", apiKey.workspace_id).eq("record_type", "knowledge").eq("record_id", id).maybeSingle();
    if (readError || !current) return json({ error: "Conhecimento não encontrado" }, 404);
    const payload = { ...current.payload, ...body, id, updatedAt: new Date().toISOString() };
    delete payload.workspace_id;
    const { error } = await admin.from("knowledge_records").update({ payload, updated_at: payload.updatedAt }).eq("workspace_id", apiKey.workspace_id).eq("record_type", "knowledge").eq("record_id", id);
    if (error) return json({ error: error.message }, 500);
    return json({ data: payload });
  }

  if (req.method === "DELETE") {
    if (!canDelete) return json({ error: "Permissão delete não concedida" }, 403);
    const id = urlObj.searchParams.get("id") || recordId;
    if (!id) return json({ error: "Informe id" }, 400);
    const { error } = await admin.from("knowledge_records").delete().eq("workspace_id", apiKey.workspace_id).eq("record_type", "knowledge").eq("record_id", id);
    if (error) return json({ error: error.message }, 500);
    return json({ deleted: id });
  }
  return json({ error: "Método não suportado" }, 405);
});
