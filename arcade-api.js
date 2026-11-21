const SUPABASE_URL = "https://zvtrluxlzrihsuvralhg.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_hwFf-GdHVxzGNYxKHltKbw_7Eq5hTzO";

const SESSION_KEY = "afterglow-api-session-v1";
const NAME_KEY = "afterglow-api-name-v1";
const GAME_IDS = new Set([
  "geometry-dash","clumsy-bird","bemuse","hextris","2048","sandspiel",
  "astray","hexgl","darkroom","particle","snake","sudoku","tic-tac-toe",
  "wordle","basketball","bowling","table-tennis","bubble-pop","stack-tower"
]);
const EVENT_NAMES = new Set([
  "arcade_open","game_open","game_load_success","game_load_error",
  "leaderboard_view","score_submit","room_create","room_join","room_leave"
]);
const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const getSessionId = () => {
  let value = sessionStorage.getItem(SESSION_KEY);
  if (!value) {
    value = crypto.randomUUID();
    sessionStorage.setItem(SESSION_KEY, value);
  }
  return value;
};
const randomName = () => "Guest-" + Math.floor(1000 + Math.random() * 9000);
const getDisplayName = () => {
  let value = localStorage.getItem(NAME_KEY);
  if (!/^[A-Za-z0-9_-]{3,16}$/.test(value || "")) {
    value = randomName();
    localStorage.setItem(NAME_KEY, value);
  }
  return value;
};
const makeRoomCode = () => Array.from({length:6}, () => alphabet[Math.floor(Math.random()*alphabet.length)]).join("");

export async function initArcadeAPI() {
  const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.119.2");
  const client = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    realtime: { params: { eventsPerSecond: 8 } }
  });
  const sessionId = getSessionId();
  let activeChannel = null;
  let activeRoom = "";
  const roomEventListeners = new Set();
  const presenceListeners = new Set();

  const call = async body => {
    const { data, error } = await client.functions.invoke("arcade-api", { body });
    if (error) throw new Error(data?.error || error.message || "Arcade API request failed.");
    if (data?.error) throw new Error(data.error);
    return data;
  };

  const api = {
    sessionId,
    get displayName() { return getDisplayName(); },
    setDisplayName(name) {
      if (!/^[A-Za-z0-9_-]{3,16}$/.test(name)) throw new Error("Use 3–16 letters, numbers, _ or -.");
      localStorage.setItem(NAME_KEY, name);
      return name;
    },
    async leaderboard(gameId) {
      if (gameId && !GAME_IDS.has(gameId)) throw new Error("Unknown game.");
      const result = await call({ action: "leaderboard", gameId: gameId || null });
      return result.leaderboard || [];
    },
    async submitScore(gameId, score, displayName = getDisplayName()) {
      if (!GAME_IDS.has(gameId)) throw new Error("Unknown game.");
      if (!Number.isSafeInteger(Number(score)) || Number(score) < 0 || Number(score) > 1000000000) throw new Error("Score must be a whole number from 0 to 1,000,000,000.");
      return call({ action: "submit_score", gameId, score: Number(score), displayName, sessionId });
    },
    async trackEvent(eventName, gameId = null) {
      if (!EVENT_NAMES.has(eventName)) return;
      return call({ action: "track_event", eventName, gameId });
    },
    async createRoom(displayName = getDisplayName()) {
      const code = makeRoomCode();
      await this.joinRoom(code, displayName);
      return code;
    },
    async joinRoom(code, displayName = getDisplayName()) {
      const cleanCode = String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (!/^[A-Z2-9]{6}$/.test(cleanCode)) throw new Error("Room codes contain 6 letters or numbers.");
      if (activeChannel) await this.leaveRoom();
      activeRoom = cleanCode;
      activeChannel = client.channel("arcade-room-" + cleanCode, {
        config: { broadcast: { self: false }, presence: { key: sessionId }, private: false }
      });
      activeChannel
        .on("broadcast", { event: "game-event" }, message => {
          for (const listener of roomEventListeners) listener(message.payload || {});
        })
        .on("presence", { event: "sync" }, () => {
          const state = activeChannel?.presenceState() || {};
          const people = Object.values(state).flat().map(item => item?.name).filter(Boolean);
          for (const listener of presenceListeners) listener(people);
        });
      await new Promise((resolve, reject) => {
        activeChannel.subscribe(async status => {
          if (status === "SUBSCRIBED") {
            const { error } = await activeChannel.track({ name: displayName, joinedAt: new Date().toISOString() });
            if (error) reject(error);
            else resolve();
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
            reject(new Error("Could not connect to that room."));
          }
        });
      });
      await api.trackEvent("room_join");
      return cleanCode;
    },
    async sendRoomEvent(type, data) {
      if (!activeChannel) throw new Error("Join a room first.");
      if (!/^[a-z0-9_-]{1,24}$/i.test(type)) throw new Error("Invalid room event.");
      const payload = { type, data, from: sessionId, at: Date.now() };
      if (JSON.stringify(payload).length > 3500) throw new Error("Room messages are limited to 3.5 KB.");
      const result = await activeChannel.send({ type: "broadcast", event: "game-event", payload });
      if (result !== "ok") throw new Error("Room message could not be sent.");
    },
    onRoomEvent(callback) {
      roomEventListeners.add(callback);
      return () => roomEventListeners.delete(callback);
    },
    onPresence(callback) {
      presenceListeners.add(callback);
      return () => presenceListeners.delete(callback);
    },
    async leaveRoom() {
      if (activeChannel) await client.removeChannel(activeChannel);
      activeChannel = null;
      if (activeRoom) await api.trackEvent("room_leave");
      activeRoom = "";
    },
    get roomCode() { return activeRoom; },
    saveProgress(gameId, value) {
      if (!GAME_IDS.has(gameId)) throw new Error("Unknown game.");
      const serialized = JSON.stringify(value);
      if (serialized.length > 500000) throw new Error("Save data exceeds 500 KB.");
      localStorage.setItem("afterglow-save-v1-" + gameId, serialized);
    },
    loadProgress(gameId) {
      if (!GAME_IDS.has(gameId)) throw new Error("Unknown game.");
      try { return JSON.parse(localStorage.getItem("afterglow-save-v1-" + gameId) || "null"); }
      catch { return null; }
    }
  };
  return api;
}
