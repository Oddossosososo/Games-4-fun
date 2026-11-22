import { createClient } from "npm:@supabase/supabase-js@2.119.2";

const cors = {
  "Access-Control-Allow-Origin": "https://oddossosososo.github.io",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json"
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: cors });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply({ error: "Method not allowed." }, 405);

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return reply({ error: "Sign in required." }, 401);

    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const publishableKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || serviceKey;
    const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const auth = createClient(url, publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } }
    });
    const { data: authData, error: authError } = await auth.auth.getUser(token);
    if (authError || !authData.user) return reply({ error: "Your session is invalid. Sign in again." }, 401);
    const actorId = authData.user.id;
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "");

    const { data: actorBadge, error: actorError } = await service
      .from("profile_badges").select("role").eq("user_id", actorId).maybeSingle();
    if (actorError) throw actorError;
    const actorRole = actorBadge?.role || "member";

    if (action === "profile_update") {
      const displayName = String(body.display_name || "").trim();
      if (!displayName || displayName.length > 40) return reply({ error: "Display name must be 1–40 characters." }, 400);
      const { error } = await service.from("profile_badges")
        .update({ display_name: displayName, updated_at: new Date().toISOString() })
        .eq("user_id", actorId);
      if (error) throw error;
      return reply({ ok: true, display_name: displayName });
    }

    if (action === "admin_list" || action === "admin_update") {
      if (!["owner", "admin"].includes(actorRole)) return reply({ error: "Admin access required." }, 403);
    }

    if (action === "admin_list") {
      const { data: badges, error } = await service.from("profile_badges")
        .select("user_id,display_name,role,is_verified,created_at").order("created_at", { ascending: true }).limit(250);
      if (error) throw error;
      const ids = (badges || []).map((row: { user_id: string }) => row.user_id);
      const { data: profiles, error: profileError } = ids.length
        ? await service.from("profiles").select("id,username").in("id", ids)
        : { data: [], error: null };
      if (profileError) throw profileError;
      const usernames = new Map((profiles || []).map((p: { id: string; username: string }) => [p.id, p.username]));
      return reply({ users: (badges || []).map((row: { user_id: string; display_name: string; role: string; is_verified: boolean; created_at: string }) => ({
        ...row, username: usernames.get(row.user_id) || ""
      })) });
    }

    if (action === "add_game") {
      if (!["owner", "admin"].includes(actorRole)) return reply({ error: "Admin access required." }, 403);
      const title = String(body.title || "").trim();
      const description = String(body.description || "").trim();
      const rawRepo = String(body.repo_url || "").trim();
      if (title.length < 2 || title.length > 60) return reply({ error: "Game name must be 2–60 characters." }, 400);
      if (!description || description.length > 300) return reply({ error: "Description must be 1–300 characters." }, 400);
      let parsed: URL;
      try { parsed = new URL(rawRepo); } catch { return reply({ error: "Enter a valid GitHub repository URL." }, 400); }
      const parts = parsed.pathname.replace(/\\.git$/i, "").split("/").filter(Boolean);
      if (parsed.protocol !== "https:" || parsed.hostname !== "github.com" || parsed.username || parsed.password ||
          parsed.search || parsed.hash || parts.length !== 2 ||
          !/^[A-Za-z0-9_.-]{1,100}$/.test(parts[0]) || !/^[A-Za-z0-9_.-]{1,100}$/.test(parts[1])) {
        return reply({ error: "Use a repository URL like https://github.com/owner/repository." }, 400);
      }
      const owner = parts[0];
      const repository = parts[1].replace(/\\.git$/i, "");
      const repoUrl = "https://github.com/" + owner + "/" + repository;
      const id = title.toLowerCase().normalize("NFKD").replace(/[\\u0300-\\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 54).replace(/-$/g, "");
      if (!id) return reply({ error: "Game name needs at least one letter or number." }, 400);
      const { data: existing, error: existingError } = await service.from("game_catalog")
        .select("id").eq("id", id).maybeSingle();
      if (existingError) throw existingError;
      if (existing) return reply({ error: "A game with that name is already in the catalogue." }, 409);
      const { data: game, error: insertError } = await service.from("game_catalog").insert({
        id, title, category: "Community", creator: owner, license: "Not reviewed",
        description, emoji: "🎮", glow: "#a78bfa", shade: "#34245d",
        mode: "external", entrypoint_url: null, official_url: repoUrl,
        source_url: repoUrl, assets: [], updated_at: new Date().toISOString()
      }).select("id,title,description,source_url").single();
      if (insertError) {
        if (insertError.code === "23505") return reply({ error: "A game with that name is already in the catalogue." }, 409);
        throw insertError;
      }
      return reply({ ok: true, game });
    }

    if (action === "admin_update") {
      const targetId = String(body.user_id || "");
      const nextRole = String(body.role || "member");
      const verified = Boolean(body.is_verified);
      if (!targetId || !["member", "vip", "admin"].includes(nextRole)) return reply({ error: "Invalid account update." }, 400);
      const { data: target, error: targetError } = await service.from("profile_badges")
        .select("role").eq("user_id", targetId).maybeSingle();
      if (targetError) throw targetError;
      if (!target) return reply({ error: "Account not found." }, 404);
      if (target.role === "owner") return reply({ error: "The Owner account is protected." }, 403);
      if (actorRole !== "owner" && (nextRole === "admin" || target.role === "admin")) {
        return reply({ error: "Only the Owner can change Admin roles." }, 403);
      }
      const { error } = await service.from("profile_badges")
        .update({ role: nextRole, is_verified: verified, updated_at: new Date().toISOString() })
        .eq("user_id", targetId);
      if (error) throw error;
      return reply({ ok: true });
    }

    return reply({ error: "Unknown action." }, 400);
  } catch (error) {
    console.error("afterglow-admin:", error);
    return reply({ error: error instanceof Error ? error.message : "Server error." }, 500);
  }
});
