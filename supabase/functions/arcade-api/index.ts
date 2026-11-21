import { createClient } from "npm:@supabase/supabase-js@2.119.2";

const allowedOrigin = "https://oddossosososo.github.io";
const corsHeaders = {
  "Access-Control-Allow-Origin": allowedOrigin,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};
const gameIds = new Set([
  "geometry-dash","clumsy-bird","bemuse","hextris","2048","sandspiel",
  "astray","hexgl","darkroom","particle","snake","sudoku","tic-tac-toe",
  "wordle","basketball","bowling","table-tennis","bubble-pop","stack-tower"
]);
const eventNames = new Set([
  "arcade_open","game_open","game_load_success","game_load_error",
  "leaderboard_view","score_submit","room_create","room_join","room_leave"
]);
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
});
const validGame = (value: unknown): value is string =>
  typeof value === "string" && gameIds.has(value);
const validName = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_-]{3,16}$/.test(value);
const validUuid = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  const origin = req.headers.get("origin");
  if (origin && origin !== allowedOrigin && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
    return json({ error: "Origin not allowed." }, 403);
  }

  try {
    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !serviceKey) return json({ error: "API is not configured." }, 503);
    const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const body = await req.json();

    if (body?.action === "leaderboard") {
      if (body.gameId && !validGame(body.gameId)) return json({ error: "Unknown game." }, 400);
      let query = admin.from("arcade_scores")
        .select("game_id,display_name,score,created_at")
        .order("score", { ascending: false })
        .order("created_at", { ascending: true })
        .limit(10);
      if (body.gameId) query = query.eq("game_id", body.gameId);
      const { data, error } = await query;
      if (error) return json({ error: "Leaderboard could not be loaded." }, 500);
      return json({ leaderboard: data ?? [] });
    }

    if (body?.action === "submit_score") {
      const { gameId, score, displayName, sessionId } = body;
      if (!validGame(gameId)) return json({ error: "Unknown game." }, 400);
      if (!Number.isSafeInteger(score) || score < 0 || score > 1000000000) return json({ error: "Score must be a whole number from 0 to 1,000,000,000." }, 400);
      if (!validName(displayName)) return json({ error: "Display name must be 3–16 letters, numbers, _ or -." }, 400);
      if (!validUuid(sessionId)) return json({ error: "Invalid session." }, 400);
      const { data, error } = await admin.rpc("record_arcade_score", {
        p_game_id: gameId, p_score: score, p_display_name: displayName, p_session_id: sessionId
      });
      if (error) return json({ error: error.message.includes("Please wait") ? error.message : "Score could not be saved." }, error.message.includes("Please wait") ? 429 : 400);
      await admin.from("arcade_analytics_events").insert({ event_name: "score_submit", game_id: gameId });
      return json({ ok: true, id: data });
    }

    if (body?.action === "track_event") {
      const { eventName, gameId = null } = body;
      if (!eventNames.has(eventName)) return json({ error: "Unknown event." }, 400);
      if (gameId !== null && !validGame(gameId)) return json({ error: "Unknown game." }, 400);
      const { error } = await admin.from("arcade_analytics_events").insert({ event_name: eventName, game_id: gameId });
      if (error) return json({ error: "Event could not be recorded." }, 500);
      return json({ ok: true });
    }

    return json({ error: "Unknown API action." }, 400);
  } catch {
    return json({ error: "Request could not be completed." }, 400);
  }
});
