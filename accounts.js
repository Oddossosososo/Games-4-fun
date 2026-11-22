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
  $("#profile-open").hidden = !signedIn;

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
async function callAdmin(action, payload = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Sign in first.");
  const response = await fetch(SUPABASE_URL + "/functions/v1/afterglow-admin", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + session.access_token,
      "apikey": SUPABASE_KEY
    },
    body: JSON.stringify({ action, ...payload })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "Request failed.");
  return result;
}
function badgeMarkup(role, verified) {
  const labels = { owner: "✦ OWNER", admin: "◆ ADMIN", vip: "★ VIP", member: "MEMBER" };
  return (role && role !== "member" ? '<span class="profile-badge ' + role + '">' + labels[role] + '</span>' : '') +
    (verified ? '<span class="profile-badge verified">✓ VERIFIED</span>' : '');
}
async function loadProfilePage() {
  if (!user) { showModal(true); return; }
  const statusEl = $("#profile-status");
  statusEl.textContent = "Loading profile…";
  $("#profile-page").classList.add("open");
  try {
    const [{ data: badge, error: badgeError }, { data: profile, error: profileError }] = await Promise.all([
      supabase.from("profile_badges").select("display_name,role,is_verified").eq("user_id", user.id).single(),
      supabase.from("profiles").select("username").eq("id", user.id).maybeSingle()
    ]);
    if (badgeError) throw badgeError;
    if (profileError) throw profileError;
    const displayName = badge.display_name || "Afterglow";
    $("#profile-name").textContent = displayName;
    $("#profile-avatar").textContent = displayName.slice(0,1).toUpperCase();
    $("#profile-handle").textContent = profile?.username ? "@" + profile.username : "Afterglow member";
    $("#profile-display-name").value = displayName;
    $("#profile-badges").innerHTML = badgeMarkup(badge.role, badge.is_verified);
    const isAdmin = ["owner","admin"].includes(badge.role);
    $("#admin-panel").hidden = !isAdmin;
    statusEl.textContent = "";
    if (isAdmin) await loadAdminUsers(badge.role);
  } catch (error) { statusEl.textContent = error.message || "Could not load profile."; }
}
async function loadAdminUsers(actorRole) {
  const root = $("#admin-users");
  root.textContent = "Loading accounts…";
  try {
    const { users } = await callAdmin("admin_list");
    root.replaceChildren();
    if (!users.length) { root.textContent = "No accounts yet."; return; }
    for (const account of users) {
      const row = document.createElement("div");
      row.className = "admin-user";
      const name = document.createElement("div");
      name.innerHTML = '<div class="admin-user-name"></div><div class="admin-user-meta"></div>';
      name.querySelector(".admin-user-name").textContent = account.display_name || "Afterglow";
      name.querySelector(".admin-user-meta").textContent = account.username ? "@" + account.username : account.user_id.slice(0,8);
      const select = document.createElement("select");
      select.setAttribute("aria-label", "Role for " + (account.display_name || "account"));
      for (const role of ["member","vip",...(actorRole === "owner" ? ["admin"] : [])]) {
        const option = document.createElement("option");
        option.value = role; option.textContent = role.toUpperCase();
        select.append(option);
      }
      select.value = account.role === "owner" ? "member" : account.role;
      const locked = account.role === "owner" || (actorRole !== "owner" && account.role === "admin");
      select.disabled = locked;
      const verifiedLabel = document.createElement("label");
      const verified = document.createElement("input");
      verified.type = "checkbox"; verified.checked = Boolean(account.is_verified);
      verified.disabled = locked;
      verifiedLabel.append(verified, document.createTextNode("Verified"));
      const save = document.createElement("button");
      save.className = "action"; save.type = "button"; save.textContent = "Save";
      save.disabled = locked;
      save.addEventListener("click", async () => {
        save.disabled = true;
        try {
          await callAdmin("admin_update", { user_id: account.user_id, role: select.value, is_verified: verified.checked });
          $("#admin-status").textContent = "Updated " + (account.display_name || "account") + ".";
          await loadAdminUsers(actorRole);
        } catch (error) { $("#admin-status").textContent = error.message; save.disabled = false; }
      });
      row.append(name, select, verifiedLabel, save);
      if (account.role === "owner") {
        const ownerTag = document.createElement("span");
        ownerTag.className = "profile-badge owner"; ownerTag.textContent = "OWNER";
        row.append(ownerTag);
      }
      root.append(row);
    }
  } catch (error) { root.textContent = error.message || "Could not load accounts."; }
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
  $("#profile-open")?.addEventListener("click", loadProfilePage);
  $("#profile-close")?.addEventListener("click", () => $("#profile-page").classList.remove("open"));
  $("#profile-save")?.addEventListener("click", async () => {
    const display_name = $("#profile-display-name").value.trim();
    $("#profile-save").disabled = true;
    try {
      await callAdmin("profile_update", { display_name });
      $("#profile-name").textContent = display_name;
      $("#profile-avatar").textContent = display_name.slice(0,1).toUpperCase();
      $("#profile-status").textContent = "Profile saved.";
    } catch (error) { $("#profile-status").textContent = error.message; }
    finally { $("#profile-save").disabled = false; }
  });

  $("#admin-add-game")?.addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = $("#admin-game-submit");
    const statusEl = $("#admin-game-status");
    const repo_url = $("#admin-game-repo").value.trim();
    const title = $("#admin-game-title").value.trim();
    const description = $("#admin-game-description").value.trim();
    submit.disabled = true;
    statusEl.textContent = "Checking licence and copying game files…";
    try {
      const result = await callAdmin("add_game", { repo_url, title, description });
      statusEl.textContent = "Cloned " + result.game.title + " (" + result.game.files + " files) into Afterglow. Refreshing…";
      form.reset();
      window.setTimeout(() => window.location.reload(), 900);
    } catch (error) {
      statusEl.textContent = error.message || "Could not add game.";
      submit.disabled = false;
    }
  });

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
