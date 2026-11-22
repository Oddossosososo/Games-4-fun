import { createClient } from "npm:@supabase/supabase-js@2.119.2";

const cors = {
  "Access-Control-Allow-Origin": "https://oddossosososo.github.io",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json"
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: cors });

const ALLOWED_LICENSES = new Set([
  "MIT", "Apache-2.0", "GPL-2.0", "GPL-2.0-only", "GPL-2.0-or-later",
  "GPL-3.0", "GPL-3.0-only", "GPL-3.0-or-later", "AGPL-3.0",
  "AGPL-3.0-only", "AGPL-3.0-or-later", "MPL-2.0", "Unlicense",
  "BSD-2-Clause", "BSD-3-Clause", "ISC"
]);
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp",
  ".ico": "image/x-icon", ".mp3": "audio/mpeg", ".ogg": "audio/ogg",
  ".wav": "audio/wav", ".mp4": "video/mp4", ".webm": "video/webm",
  ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf",
  ".otf": "font/otf", ".wasm": "application/wasm", ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml", ".webmanifest": "application/manifest+json"
};
const excluded = (path: string) =>
  /(^|\/)(\.git|\.github|\.vscode|node_modules|coverage|__tests__|\.next)(\/|$)/i.test(path) ||
  /(^|\/)(README|CONTRIBUTING|CHANGELOG|LICENSE|CODE_OF_CONDUCT)(\.[^/]*)?$/i.test(path) ||
  /\.(map|lock|md|mdx|yml|yaml|toml|rs|c|cc|cpp|h|hpp|py|sh|bat|ps1)$/i.test(path) ||
  /(^|\/)(\.gitignore|\.gitattributes|\.editorconfig|\.npmrc|\.prettierrc)$/i.test(path);

function contentType(path: string) {
  const ext = path.match(/\.[^.\/]+$/)?.[0].toLowerCase() || "";
  return MIME[ext] || "application/octet-stream";
}
function safePath(path: string) {
  return path && !path.startsWith("/") && !path.includes("\\") &&
    path.split("/").every(part => part && part !== "." && part !== "..");
}
function rewriteRootAssets(source: string, gameId: string, files: Set<string>, publicBase: string) {
  const replace = (reference: string) => {
    if (!reference.startsWith("/") || reference.startsWith("//")) return reference;
    const split = reference.search(/[?#]/);
    const pathname = split < 0 ? reference.slice(1) : reference.slice(1, split);
    const suffix = split < 0 ? "" : reference.slice(split);
    if (!files.has(pathname)) return reference;
    return publicBase + "/" + gameId + "/" + pathname + suffix;
  };
  source = source.replace(/(["'`])(\/[^"'\`\s<>]*)\1/g, (whole, quote, reference) => {
    const next = replace(reference);
    return next === reference ? whole : quote + next + quote;
  });
  source = source.replace(/url\(\s*(\/[^)'"\s]+)\s*\)/gi, (whole, reference) => {
    const next = replace(reference);
    return next === reference ? whole : "url(" + next + ")";
  });
  return source;
}

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

    if (action === "admin_list" || action === "admin_update" || action === "add_game") {
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
      const title = String(body.title || "").trim();
      const description = String(body.description || "").trim();
      const rawRepo = String(body.repo_url || "").trim();
      if (title.length < 2 || title.length > 60) return reply({ error: "Game name must be 2–60 characters." }, 400);
      if (!description || description.length > 300) return reply({ error: "Description must be 1–300 characters." }, 400);

      let parsed: URL;
      try { parsed = new URL(rawRepo); } catch { return reply({ error: "Enter a valid GitHub repository URL." }, 400); }
      const parts = parsed.pathname.replace(/\.git$/i, "").split("/").filter(Boolean);
      if (parsed.protocol !== "https:" || parsed.hostname !== "github.com" || parsed.username || parsed.password ||
          parsed.search || parsed.hash || parts.length !== 2 ||
          !/^[A-Za-z0-9_.-]{1,100}$/.test(parts[0]) || !/^[A-Za-z0-9_.-]{1,100}$/.test(parts[1])) {
        return reply({ error: "Use a repository URL like https://github.com/owner/repository." }, 400);
      }
      const owner = parts[0];
      const repository = parts[1].replace(/\.git$/i, "");
      const repoUrl = "https://github.com/" + owner + "/" + repository;
      const id = title.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40).replace(/-$/g, "");
      if (!id) return reply({ error: "Game name needs at least one letter or number." }, 400);

      const { data: existing, error: existingError } = await service.from("game_catalog")
        .select("id").eq("id", id).maybeSingle();
      if (existingError) throw existingError;
      if (existing) return reply({ error: "A game with that name is already in the catalogue." }, 409);

      const headers = { "Accept": "application/vnd.github+json", "User-Agent": "Afterglow-Arcade" };
      const metaResponse = await fetch("https://api.github.com/repos/" + owner + "/" + repository, { headers });
      if (!metaResponse.ok) {
        return reply({ error: metaResponse.status === 404 ? "Repository not found or it is private." : "GitHub could not inspect that repository. Try again shortly." }, 400);
      }
      const metadata = await metaResponse.json();
      const license = metadata.license?.spdx_id || "NOASSERTION";
      if (!ALLOWED_LICENSES.has(license)) {
        return reply({ error: "This repository's licence (" + license + ") is not on the approved redistribution list, so it cannot be copied into Afterglow." }, 400);
      }
      const branch = String(metadata.default_branch || "main");
      const treeResponse = await fetch(
        "https://api.github.com/repos/" + owner + "/" + repository + "/git/trees/" + encodeURIComponent(branch) + "?recursive=1",
        { headers }
      );
      if (!treeResponse.ok) return reply({ error: "Could not read the repository file tree." }, 400);
      const treeData = await treeResponse.json();
      if (treeData.truncated) return reply({ error: "This repository is too large to import safely." }, 400);

      const entries = (treeData.tree || []).filter((item: any) =>
        item.type === "blob" && safePath(String(item.path || "")) && !excluded(item.path) &&
        Number(item.size || 0) > 0 && Number(item.size || 0) <= 2500000
      );
      const totalBytes = entries.reduce((sum: number, item: any) => sum + Number(item.size || 0), 0);
      if (entries.length > 120 || totalBytes > 12000000) {
        return reply({ error: "Repository is too large for the one-click importer (limit: 120 files / 12 MB)." }, 400);
      }
      const htmlEntries = entries.filter((item: any) => /(^|\/)index\.html?$/i.test(item.path));
      const entrypoint = htmlEntries.sort((a: any, b: any) => {
        const priority = (p: string) => p === "index.html" || p === "index.htm" ? 0 :
          /^(dist|build|public)\/index\.html?$/i.test(p) ? 1 : p.split("/").length + 2;
        return priority(a.path) - priority(b.path) || a.path.localeCompare(b.path);
      })[0]?.path;
      if (!entrypoint) return reply({ error: "No playable index.html was found. This importer supports ready-to-run browser games, not source-only projects that need a build step." }, 400);

      const paths = new Set(entries.map((item: any) => String(item.path)));
      const publicBase = url + "/storage/v1/object/public/arcade-games";
      const downloaded: { path: string; bytes: Uint8Array; type: string }[] = [];
      for (let start = 0; start < entries.length; start += 5) {
        const batch = entries.slice(start, start + 5);
        const files = await Promise.all(batch.map(async (item: any) => {
          const rawPath = String(item.path).split("/").map(encodeURIComponent).join("/");
          const branchPath = branch.split("/").map(encodeURIComponent).join("/");
          const response = await fetch("https://raw.githubusercontent.com/" + owner + "/" + repository + "/" + branchPath + "/" + rawPath);
          if (!response.ok) throw new Error("Could not download repository file: " + item.path);
          let bytes = new Uint8Array(await response.arrayBuffer());
          const type = contentType(item.path);
          if (type.startsWith("text/") || type.includes("javascript") || type.includes("json") || type.includes("xml")) {
            const text = new TextDecoder().decode(bytes);
            bytes = new TextEncoder().encode(rewriteRootAssets(text, id, paths, publicBase));
          }
          return { path: String(item.path), bytes, type };
        }));
        downloaded.push(...files);
      }

      const uploadedPaths: string[] = [];
      try {
        for (let start = 0; start < downloaded.length; start += 5) {
          const batch = downloaded.slice(start, start + 5);
          const results = await Promise.all(batch.map(async file => {
            const objectPath = id + "/" + file.path;
            const { error } = await service.storage.from("arcade-games").upload(
              objectPath, new Blob([file.bytes], { type: file.type }),
              { contentType: file.type, cacheControl: "31536000", upsert: true }
            );
            if (error) throw new Error("Storage upload failed for " + file.path + ": " + error.message);
            uploadedPaths.push(objectPath);
          }));
        }
      } catch (uploadError) {
        if (uploadedPaths.length) await service.storage.from("arcade-games").remove(uploadedPaths);
        throw uploadError;
      }

      const entrypointUrl = publicBase + "/" + id + "/" + entrypoint.split("/").map(encodeURIComponent).join("/");
      const assets = downloaded.map(file => ({
        path: file.path, url: publicBase + "/" + id + "/" + file.path.split("/").map(encodeURIComponent).join("/"),
        content_type: file.type, size: file.bytes.byteLength
      }));
      const { data: game, error: insertError } = await service.from("game_catalog").insert({
        id, title, category: "Community", creator: metadata.owner?.login || owner,
        license, description, emoji: "🎮", glow: "#a78bfa", shade: "#34245d",
        mode: "local", entrypoint_url: entrypointUrl, official_url: repoUrl,
        source_url: repoUrl, assets, updated_at: new Date().toISOString()
      }).select("id,title,description,source_url,entrypoint_url,assets").single();
      if (insertError) {
        await service.storage.from("arcade-games").remove(uploadedPaths);
        if (insertError.code === "23505") return reply({ error: "A game with that name is already in the catalogue." }, 409);
        throw insertError;
      }
      return reply({ ok: true, game: { id: game.id, title: game.title, source_url: game.source_url, entrypoint_url: game.entrypoint_url, files: assets.length } });
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
