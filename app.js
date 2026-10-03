/* Swan v1 shared app logic. Requires config.js + supabase-js CDN loaded first. */
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* Redirect to auth.html when there is no session. Returns the user. */
async function requireAuth() {
  try {
    const { data } = await sb.auth.getSession();
    if (!data || !data.session) { window.location.href = "auth.html"; return null; }
    return data.session.user;
  } catch (e) {
    window.location.href = "auth.html";
    return null;
  }
}

/* Current user's profile row (or null). */
async function currentProfile() {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;
  const { data } = await sb.from("profiles").select("*").eq("id", user.id).single();
  return data || null;
}

/* Escape user content for HTML. */
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}

/* "5m", "3h", "2d"... */
function timeAgo(ts) {
  if (!ts) return "";
  const s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return m + "m";
  const h = Math.floor(m / 60);
  if (h < 24) return h + "h";
  const d = Math.floor(h / 24);
  if (d < 7) return d + "d";
  return new Date(ts).toLocaleDateString();
}

function isVideo(url) {
  return /\.(mp4|mov|webm|m4v)(\?|#|$)/i.test(url || "");
}

function avatarHTML(url, name, size) {
  size = size || 40;
  const nm = esc(name || "S");
  if (url) {
    return '<img class="avatar" style="width:' + size + 'px;height:' + size + 'px" src="' + esc(url) + '" alt="' + nm + '">';
  }
  const initial = (nm.charAt(0) || "S").toUpperCase();
  return '<span class="avatar-fallback" style="width:' + size + 'px;height:' + size + 'px;font-size:' + Math.floor(size / 2.4) + 'px">' + initial + "</span>";
}

function errHTML(e) {
  const msg = e && e.message ? e.message : String(e);
  return '<div class="error-box">Something went wrong: ' + esc(msg) + "</div>";
}

/* ---- shared music player (one stream at a time) ---- */
let musicAudio = null;
let musicBtn = null;
function toggleMusic(url, btn) {
  const label = btn.querySelector(".mstate");
  if (musicAudio && musicBtn === btn && !musicAudio.paused) {
    musicAudio.pause();
    btn.classList.remove("playing");
    if (label) label.textContent = "▶";
    return;
  }
  if (musicAudio) {
    musicAudio.pause();
    if (musicBtn) {
      musicBtn.classList.remove("playing");
      const l = musicBtn.querySelector(".mstate");
      if (l) l.textContent = "▶";
    }
  }
  musicAudio = new Audio(url);
  musicBtn = btn;
  btn.classList.add("playing");
  if (label) label.textContent = "⏸";
  musicAudio.play().catch(function () {
    btn.classList.remove("playing");
    if (label) label.textContent = "▶";
  });
  musicAudio.onended = function () {
    btn.classList.remove("playing");
    if (label) label.textContent = "▶";
  };
}

function musicBarHTML(post) {
  const src = post.music_source || "audius";
  if (src === "audius") {
    if (!post.music_stream_url) return "";
    return '<button class="musicbar" data-url="' + esc(post.music_stream_url) + '" onclick="toggleMusic(this.dataset.url, this)">' +
      '<span class="mstate">▶</span>' +
      '<span class="mtrack"><b>' + esc(post.music_title || "Unknown track") + "</b> · " + esc(post.music_artist || "Unknown artist") + "</span>" +
      '<span class="mlabel">Audius</span></button>';
  }
  // spotify / apple: open the external track link in a new tab
  if (!post.music_external_url && !post.music_title) return "";
  const label = src === "apple" ? "Play on Apple Music" : "Play on Spotify";
  const href = post.music_external_url ? ' href="' + esc(post.music_external_url) + '" target="_blank" rel="noopener"' : "";
  const tag = post.music_external_url ? "a" : "span";
  return "<" + tag + ' class="musicbar"' + href + ">" +
    '<span class="mstate">♪</span>' +
    '<span class="mtrack"><b>' + esc(post.music_title || "Unknown track") + "</b> · " + esc(post.music_artist || "Unknown artist") + "</span>" +
    '<span class="mlabel">' + label + (post.music_external_url ? " ↗" : "") + "</span></" + tag + ">";
}

/* ---- top bar ---- */
const SVG_HEART = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21.2l7.8-7.8 1-1a5.5 5.5 0 0 0 0-7.8z"/></svg>';
const SVG_PLUS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';

function topBar(opts) {
  opts = opts || {};
  let html = '<header class="topbar">' +
    '<a class="brand" href="index.html"><img src="assets/swan-logo.webp" alt="Swan"><span>Swan</span></a>' +
    '<div class="topbar-actions">';
  if (opts.activity !== false) html += '<a class="icon-btn" href="activity.html" aria-label="Activity">' + SVG_HEART + "</a>";
  if (opts.compose !== false) html += '<a class="icon-btn" href="compose.html" aria-label="New post">' + SVG_PLUS + "</a>";
  html += "</div></header>";
  document.body.insertAdjacentHTML("afterbegin", html);
}

/* ---- bottom nav ---- */
function bottomNav(active) {
  const defs = [
    { id: "home", label: "Home", href: "index.html",
      svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/></svg>' },
    { id: "explore", label: "Explore", href: "explore.html",
      svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>' },
    { id: "reels", label: "Reels", href: "reels.html",
      svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M7 4v16M17 4v16M2 9h5M2 15h5M17 9h5M17 15h5"/></svg>' },
    { id: "messages", label: "Messages", href: "messages.html",
      svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>' },
    { id: "profile", label: "Profile", href: "profile.html",
      svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>' }
  ];
  let html = '<nav class="bottomnav">';
  defs.forEach(function (d) {
    html += '<a href="' + d.href + '"' + (active === d.id ? ' class="active"' : "") + ">" + d.svg + "<span>" + d.label + "</span></a>";
  });
  html += "</nav>";
  document.body.insertAdjacentHTML("beforeend", html);
}

/* ---- DMs: find or create a 1:1 conversation, then open it ---- */
async function openConversation(myId, otherId) {
  const { data: mine } = await sb.from("conversation_members").select("conversation_id").eq("user_id", myId);
  const ids = (mine || []).map(function (m) { return m.conversation_id; });
  let convId = null;
  if (ids.length) {
    const { data: shared } = await sb.from("conversation_members")
      .select("conversation_id").eq("user_id", otherId).in("conversation_id", ids).limit(1);
    if (shared && shared.length) convId = shared[0].conversation_id;
  }
  if (!convId) {
    const { data: conv, error: cErr } = await sb.from("conversations").insert({}).select().single();
    if (cErr) throw cErr;
    convId = conv.id;
    const { error: m1 } = await sb.from("conversation_members").insert({ conversation_id: convId, user_id: myId });
    if (m1) throw m1;
    const { error: m2 } = await sb.from("conversation_members").insert({ conversation_id: convId, user_id: otherId });
    if (m2) throw m2;
  }
  window.location.href = "messages.html?c=" + convId;
}

/* ---- upload a file to the media bucket, return public URL ---- */
async function uploadMedia(userId, file) {
  const safe = file.name.replace(/[^a-zA-Z0-9.\-_]/g, "_");
  const path = userId + "/" + Date.now() + "_" + safe;
  const { error } = await sb.storage.from("media").upload(path, file);
  if (error) throw error;
  const { data } = sb.storage.from("media").getPublicUrl(path);
  return data.publicUrl;
}
