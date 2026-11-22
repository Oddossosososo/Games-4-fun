import { createClient } from "https://esm.sh/@supabase/supabase-js@2.119.2";

const SUPABASE_URL = "https://zvtrluxlzrihsuvralhg.supabase.co";
const SUPABASE_KEY = "sb_publishable_hwFf-GdHVxzGNYxKHltKbw_7Eq5hTzO";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

const $ = selector => document.querySelector(selector);
let user = null;
let mode = "signin";
let pendingEmail = "";
let pendingUsername = "";
let awaitingVerification = false;

function status(message, error = false) {
  const el = $("#account-status");
  if (el) { el.textContent = message; el.style.color = error ? "#ff9baf" : "var(--cyan)"; }
}
function showModal(open = true) {
  $("#account-modal")?.classList.toggle("open", open);
  if (open) $("#account-email")?.focus();
}
function renderUser(current) {
  user = current || null;
  const signedIn = Boolean(user);
  $("#account-form").hidden = signedIn || awaitingVerification;
  $("#account-code-form").hidden = signedIn || !awaitingVerification;
  $("#account-signed-in").hidden = !signedIn;
  $("#account-switch").hidden = signedIn;
  $("#account-open").textContent = signedIn ? "Account" : "Sign in";
  $("#account-user").hidden = true;
  $("#account-user").textContent = signedIn ? "Signed in" : "";
  $("#account-profile").textContent = signedIn ? "Your account is signed in." : "";
  if (signedIn) window.setTimeout(() => loadProfile(), 0);
  else status("");
}
async function loadProfile() {
  if (!user) return;
  const { data, error } = await supabase.from("profiles").select("username").eq("id", user.id).maybeSingle();
  if (error) { status(error.message, true); return; }
  $("#account-profile-name").value = data?.username || "";
}
async function loadFavorites() {
  if (!user) return;
  const { data, error } = await supabase.from("favourites").select("game_id").eq("user_id", user.id);
  if (error) { status("Could not load favourites: " + error.message, true); return; }
  window.dispatchEvent(new CustomEvent("afterglow:sync-favorites", { detail: (data || []).map(row => row.game_id) }));
}
async function syncFavorites() {
  if (!user) return;
  const ids = JSON.parse(localStorage.getItem("afterglow-favorites") || "[]")
    .filter(id => typeof id === "string" && /^[a-z0-9-]{1,40}$/.test(id));
  let removeQuery = supabase.from("favourites").delete().eq("user_id", user.id);
  if (ids.length) removeQuery = removeQuery.not("game_id", "in", "(" + ids.join(",") + ")");
  const { error: removeError } = await removeQuery;
  if (removeError) throw removeError;
  if (ids.length) {
    const { error } = await supabase.from("favourites").upsert(ids.map(game_id => ({ user_id: user.id, game_id })), { onConflict: "user_id,game_id" });
    if (error) throw error;
  }
}
async function syncSaves() {
  if (!user) throw new Error("Sign in first.");
  const prefix = "afterglow-save-v1-";
  const local = Object.keys(localStorage).filter(key => key.startsWith(prefix));
  let uploaded = 0;
  for (const key of local) {
    const game_id = key.slice(prefix.length);
    let save_data;
    try { save_data = JSON.parse(localStorage.getItem(key)); } catch { continue; }
    const { error } = await supabase.from("game_saves").upsert(
      { user_id: user.id, game_id, save_data, updated_at: new Date().toISOString() },
      { onConflict: "user_id,game_id" }
    );
    if (error) throw error;
    uploaded++;
  }
  const { data, error } = await supabase.from("game_saves").select("game_id,save_data").eq("user_id", user.id);
  if (error) throw error;
  for (const row of data || []) {
    if (!localStorage.getItem(prefix + row.game_id)) {
      localStorage.setItem(prefix + row.game_id, JSON.stringify(row.save_data));
    }
  }
  return { uploaded, restored: (data || []).length };
}

export async function initAccounts() {
  $("#account-open")?.addEventListener("click", () => showModal(true));
  $("#account-close")?.addEventListener("click", () => showModal(false));
  $("#account-modal")?.addEventListener("click", event => { if (event.target.id === "account-modal") showModal(false); });
  $("#account-switch")?.addEventListener("click", () => {
    mode = mode === "signin" ? "signup" : "signin";
    $("#account-title").textContent = mode === "signin" ? "Welcome back" : "Create your account";
    $("#account-submit").textContent = mode === "signin" ? "Sign in" : "Create account";
    $("#account-switch").textContent = mode === "signin" ? "Create account" : "I already have an account";
    $("#account-username-wrap").hidden = mode !== "signup";
    $("#account-password").autocomplete = mode === "signin" ? "current-password" : "new-password";
    awaitingVerification = false;
    $("#account-code-form").hidden = true;
    $("#account-form").hidden = false;
    status("");
  });
  $("#account-form")?.addEventListener("submit", async event => {
    event.preventDefault();
    const email = $("#account-email").value.trim();
    const password = $("#account-password").value;
    const username = $("#account-username").value.trim();
    if (mode === "signup" && username && !/^[A-Za-z0-9_-]{3,20}$/.test(username)) {
      status("Username must be 3–20 letters, numbers, _ or -.", true); return;
    }
    $("#account-submit").disabled = true;
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        if (data.session) {
          if (username) {
            const { error: profileError } = await supabase.from("profiles").upsert({ id: data.user.id, username, username_normalized: username.toLowerCase() });
            if (profileError) throw profileError;
          }
          status("Account created. You're signed in.");
        } else {
          pendingEmail = email;
          pendingUsername = username;
          awaitingVerification = true;
          $("#account-form").hidden = true;
          $("#account-code-form").hidden = false;
          $("#account-title").textContent = "Verify your email";
          $("#account-code").value = "";
          $("#account-code").focus();
          status("We sent a 6-digit verification code to your email.");
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        status("Signed in successfully.");
      }
    } catch (error) { status(error.message || "Authentication failed.", true); }
    finally { $("#account-submit").disabled = false; }
  });
  $("#account-code-form")?.addEventListener("submit", async event => {
    event.preventDefault();
    const token = $("#account-code").value.trim();
    if (!/^\\d{6}$/.test(token)) { status("Enter the 6-digit code from your email.", true); return; }
    const submit = $("#account-verify");
    submit.disabled = true;
    try {
      const { data, error } = await supabase.auth.verifyOtp({ email: pendingEmail, token, type: "signup" });
      if (error) throw error;
      if (pendingUsername && data.user) {
        const { error: profileError } = await supabase.from("profiles").upsert({
          id: data.user.id, username: pendingUsername, username_normalized: pendingUsername.toLowerCase()
        });
        if (profileError) throw profileError;
      }
      awaitingVerification = false;
      $("#account-code-form").hidden = true;
      $("#account-title").textContent = "Your Afterglow account";
      renderUser(data.user);
      status("Email verified. Your account is ready.");
    } catch (error) { status(error.message || "Code verification failed.", true); }
    finally { submit.disabled = false; }
  });
  $("#account-resend")?.addEventListener("click", async () => {
    if (!pendingEmail) return;
    const button = $("#account-resend");
    button.disabled = true;
    try {
      const { error } = await supabase.auth.resend({ type: "signup", email: pendingEmail });
      if (error) throw error;
      status("A new 6-digit code has been sent.");
    } catch (error) { status(error.message || "Could not resend the code.", true); }
    finally { button.disabled = false; }
  });

  $("#account-save-profile")?.addEventListener("click", async () => {
    if (!user) return;
    const username = $("#account-profile-name").value.trim();
    if (!/^[A-Za-z0-9_-]{3,20}$/.test(username)) { status("Username must be 3–20 letters, numbers, _ or -.", true); return; }
    const { error } = await supabase.from("profiles").upsert({ id: user.id, username, username_normalized: username.toLowerCase() });
    status(error ? error.message : "Username saved.", Boolean(error));
  });
  $("#account-sync")?.addEventListener("click", async () => {
    try { const result = await syncSaves(); status("Game saves synced. " + result.uploaded + " uploaded; " + result.restored + " available."); }
    catch (error) { status(error.message || "Save sync failed.", true); }
  });
  $("#account-signout")?.addEventListener("click", async () => {
    const { error } = await supabase.auth.signOut();
    if (error) status(error.message, true);
    else { renderUser(null); status("Signed out."); }
  });

  document.addEventListener("click", event => {
    if (event.target.closest("#favorite-toggle") && user) {
      window.setTimeout(() => syncFavorites().then(() => status("Favourites synced.")).catch(error => status(error.message, true)), 0);
    }
  });

  const { data: { session } } = await supabase.auth.getSession();
  renderUser(session?.user || null);
  if (session?.user) { await loadFavorites(); await syncSaves().catch(error => console.warn("Save restore skipped:", error)); }
  supabase.auth.onAuthStateChange((_event, nextSession) => {
    renderUser(nextSession?.user || null);
    if (nextSession?.user) window.setTimeout(() => {
      loadFavorites();
      syncSaves().catch(error => console.warn("Save restore skipped:", error));
    }, 0);
  });

  const api = {
    async getCatalog() {
      const { data, error } = await supabase.from("game_catalog")
        .select("id,title,category,creator,license,description,emoji,glow,shade,mode,entrypoint_url,official_url,source_url,assets")
        .order("title");
      if (error) throw error;
      return (data || []).map(game => ({
        id: game.id, title: game.title, category: game.category, creator: game.creator,
        license: game.license, desc: game.description, emoji: game.emoji, glow: game.glow,
        shade: game.shade, mode: game.mode, entrypoint_url: game.entrypoint_url,
        officialUrl: game.official_url, source: game.source_url, assets: game.assets || [],
        verified: true, embeddable: ["local","bundled"].includes(game.mode)
      }));
    },
    async saveGame(gameId, saveData) {
      if (!user) throw new Error("Sign in to sync game saves.");
      const { error } = await supabase.from("game_saves").upsert(
        { user_id: user.id, game_id: gameId, save_data: saveData, updated_at: new Date().toISOString() },
        { onConflict: "user_id,game_id" }
      );
      if (error) throw error;
    },
    get user() { return user; }
  };
  window.AfterglowAccounts = api;
  return api;
}
