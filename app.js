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
  let { data } = await sb.from("profiles").select("*").eq("id", user.id).single();
  if (!data) {
    // Safety net: profile row missing (e.g. signed up before the auto-create trigger).
    const uname = (user.user_metadata && user.user_metadata.username) || ("user_" + user.id.slice(0, 8));
    const { data: created } = await sb.from("profiles").insert({ id: user.id, username: uname, display_name: uname }).select().single();
    data = created || null;
  }
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
let feedAudio = null;
let feedAudioBar = null;
let feedAudioTimer = null;
let audioUnlocked = false;

function stopFeedAudioUI() {
  if (feedAudioTimer) { clearTimeout(feedAudioTimer); feedAudioTimer = null; }
  if (feedAudioBar) {
    feedAudioBar.classList.remove("playing");
    const l = feedAudioBar.querySelector(".mstate");
    if (l) l.textContent = "▶";
    feedAudioBar = null;
  }
}
function stopFeedAudio() {
  if (feedAudio) { try { feedAudio.pause(); } catch (e) {} feedAudio = null; }
  stopFeedAudioUI();
}
function playAudiusBar(bar) {
  stopAllPlayback();
  const url = bar.dataset.url;
  const start = parseFloat(bar.dataset.start || 0);
  const dur = bar.dataset.dur ? parseFloat(bar.dataset.dur) : null;
  feedAudio = new Audio(url);
  feedAudioBar = bar;
  bar.classList.add("playing");
  const label = bar.querySelector(".mstate");
  if (label) label.textContent = "⏸";
  const begin = function () {
    try { if (start > 0 && isFinite(start)) feedAudio.currentTime = start; } catch (e) {}
    const p = feedAudio.play();
    if (p && p.catch) p.catch(function () { stopFeedAudio(); });
  };
  if (feedAudio.readyState >= 1) begin();
  else feedAudio.addEventListener("loadedmetadata", begin, { once: true });
  if (dur && dur > 0) feedAudioTimer = setTimeout(stopFeedAudio, dur * 1000);
  feedAudio.onended = stopFeedAudio;
}
function toggleMusic(url, btn, start, dur) {
  if (feedAudioBar === btn && feedAudio && !feedAudio.paused) { stopFeedAudio(); return; }
  playAudiusBar(btn);
}

/* ---- YouTube IFrame Player API (programmatic play / pause / resume) ---- */
let ytApiReady = false;
const ytReadyQueue = [];
let activeYTPlayer = null;
let activeYTBox = null;

function loadYouTubeAPI() {
  if (window.YT && window.YT.Player) { ytApiReady = true; return; }
  if (document.querySelector("script[data-yt-api]")) return;
  window.onYouTubeIframeAPIReady = function () {
    ytApiReady = true;
    ytReadyQueue.splice(0).forEach(function (fn) { try { fn(); } catch (e) {} });
  };
  const s = document.createElement("script");
  s.src = "https://www.youtube.com/iframe_api";
  s.setAttribute("data-yt-api", "1");
  document.head.appendChild(s);
}
function whenYTReady(fn) {
  if (window.YT && window.YT.Player) { ytApiReady = true; fn(); return; }
  ytReadyQueue.push(fn);
  loadYouTubeAPI();
}
function ytPause() {
  if (activeYTPlayer) { try { activeYTPlayer.pauseVideo(); } catch (e) {} }
}
function ytStop() {
  if (activeYTPlayer) { try { activeYTPlayer.destroy(); } catch (e) {} activeYTPlayer = null; }
  if (activeYTBox) {
    if (activeYTBox.classList.contains("cs-yt") && activeYTBox.dataset.orig) {
      activeYTBox.innerHTML = activeYTBox.dataset.orig;
    } else {
      activeYTBox.innerHTML = "";
    }
    activeYTBox = null;
  }
  document.querySelectorAll(".yt-play").forEach(function (x) { x.style.display = ""; });
  document.querySelectorAll(".musicbar.ext.playing").forEach(function (b) { b.classList.remove("playing"); });
}
function mountYTPlayer(box, vid) {
  box.innerHTML = "";
  const mount = document.createElement("div");
  box.appendChild(mount);
  whenYTReady(function () {
    if (!document.body.contains(mount)) return; // user moved on already
    try {
      activeYTPlayer = new YT.Player(mount, {
        width: "100%",
        videoId: vid,
        playerVars: { autoplay: 1, rel: 0 },
        events: { onReady: function (e) { try { e.target.playVideo(); } catch (err) {} } },
      });
      activeYTBox = box;
    } catch (e) {}
  });
}
function playYouTubeBar(bar) {
  if (!bar) return false;
  const btn = bar.querySelector(".yt-play");
  const slot = bar.querySelector(".yt-slot");
  if (!btn || !slot || !btn.dataset.vid) {
    if (btn && btn.dataset.url) window.open(btn.dataset.url, "_blank");
    return false;
  }
  stopFeedAudio();
  ytStop();
  btn.style.display = "none";
  bar.classList.add("playing");
  mountYTPlayer(slot, btn.dataset.vid);
  return true;
}
function playYouTubeCard(el) {
  if (!el.dataset.vid || (activeYTBox === el && activeYTPlayer)) return false;
  if (!el.dataset.orig) el.dataset.orig = el.innerHTML;
  stopFeedAudio();
  ytStop();
  mountYTPlayer(el, el.dataset.vid);
  return true;
}
function stopAllPlayback() {
  stopFeedAudio();
  ytPause();
  // twitch embeds can't pause cleanly — tear them down so streams stop off-screen
  document.querySelectorAll(".cs-tw iframe").forEach(function (f) {
    const el = f.closest(".cs-tw");
    if (el && el.dataset.orig) el.innerHTML = el.dataset.orig;
  });
}

/* ---- scroll autoplay: a post's music starts as it scrolls into view ---- */
let autoplayObs = null;
let activeCard = null;
const visMap = new Map();

function unlockAudio() {
  if (audioUnlocked) return;
  audioUnlocked = true;
  const pill = document.getElementById("soundpill");
  if (pill) pill.remove();
  pickActive();
}
document.addEventListener("pointerdown", unlockAudio);

function pickActive() {
  let best = null, bestR = 0.55;
  visMap.forEach(function (r, card) {
    if (!document.body.contains(card)) { visMap.delete(card); return; }
    if (r > bestR) { bestR = r; best = card; }
  });
  if (best === activeCard) return;
  activeCard = best;
  stopAllPlayback();
  if (best && audioUnlocked) startCardAudio(best);
}
function startCardAudio(card) {
  const abar = card.querySelector('.musicbar[data-url]');
  if (abar) { playAudiusBar(abar); return; }
  const bar = card.querySelector(".musicbar.ext");
  const ybtn = bar ? bar.querySelector(".yt-play") : null;
  if (ybtn && ybtn.dataset.vid) {
    const slot = bar.querySelector(".yt-slot");
    if (activeYTBox === slot && activeYTPlayer) {
      try { activeYTPlayer.playVideo(); } catch (e) {}
      bar.classList.add("playing");
      ybtn.style.display = "none";
    } else {
      playYouTubeBar(bar);
    }
    return;
  }
  const yc = card.querySelector(".cs-yt[data-vid]");
  if (yc) {
    if (activeYTBox === yc && activeYTPlayer) { try { activeYTPlayer.playVideo(); } catch (e) {} }
    else playYouTubeCard(yc);
  }
}
function initFeedAutoplay(root) {
  if (autoplayObs) { autoplayObs.disconnect(); autoplayObs = null; }
  visMap.clear();
  activeCard = null;
  if (!("IntersectionObserver" in window)) return;
  if (!audioUnlocked && !document.getElementById("soundpill")) {
    const pill = document.createElement("div");
    pill.id = "soundpill";
    pill.textContent = "🔊 Tap anywhere for sound";
    pill.addEventListener("click", unlockAudio);
    document.body.appendChild(pill);
  }
  const cards = root.querySelectorAll("article.card");
  if (!cards.length) return;
  autoplayObs = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) { visMap.set(en.target, en.isIntersecting ? en.intersectionRatio : 0); });
    pickActive();
  }, { threshold: [0, 0.25, 0.5, 0.6, 0.75, 1] });
  cards.forEach(function (c) { autoplayObs.observe(c); });
  pickActive();
}

/* ---- archive / delete (own posts) ---- */
async function archivePost(pid, arch) {
  const { error } = await sb.from("posts").update({ archived: !!arch }).eq("id", pid);
  if (error) throw error;
}
async function deletePost(pid) {
  const { error } = await sb.from("posts").delete().eq("id", pid);
  if (error) throw error;
}
function closePostMenu() {
  const o = document.getElementById("postmenu-ov");
  if (o) o.remove();
}

/* ---- inline players: YouTube + Spotify preview (no API keys needed) ---- */
document.addEventListener("click", function (e) {
  const yb = e.target.closest(".yt-play");
  if (yb) {
    playYouTubeBar(yb.closest(".musicbar"));
    return;
  }
  const pb = e.target.closest(".sp-play");
  if (pb) {
    const bar = pb.closest(".musicbar");
    const slot = bar ? bar.querySelector(".sp-slot") : null;
    stopAllPlayback();
    if (slot) {
      slot.innerHTML = '<iframe src="https://open.spotify.com/embed/track/' + pb.dataset.tid +
        '?utm_source=generator&theme=0" allow="autoplay; encrypted-media" loading="lazy"></iframe>';
      pb.style.display = "none";
    }
  }
});
function openPostMenu(pid, isArchived) {
  closePostMenu();
  const ov = document.createElement("div");
  ov.id = "postmenu-ov";
  ov.className = "sheet-ov";
  ov.innerHTML = '<div class="sheet">' +
    (isArchived ? "" : '<button data-act="addphotos">Add photos</button>') +
    (isArchived ? '<button data-act="unarchive">Unarchive</button>' : '<button data-act="archive">Archive</button>') +
    '<button data-act="delete" class="danger">Delete</button>' +
    '<button data-act="cancel">Cancel</button></div>';
  document.body.appendChild(ov);
  ov.addEventListener("click", async function (e) {
    const b = e.target.closest("button");
    if (!b || b.dataset.act === "cancel" || e.target === ov) { closePostMenu(); return; }
    const act = b.dataset.act;
    if (act === "addphotos") {
      closePostMenu();
      const fi = document.createElement("input");
      fi.type = "file";
      fi.accept = "image/*,video/*";
      fi.multiple = true;
      fi.onchange = async function () {
        const files = Array.from(fi.files || []);
        if (!files.length) return;
        try {
          const urls = [];
          for (const f of files) urls.push(await uploadMedia(ME.id, f));
          const { data: cur, error: selErr } = await sb.from("posts").select("media_urls").eq("id", pid).single();
          if (selErr) throw selErr;
          const { error } = await sb.from("posts").update({ media_urls: (cur.media_urls || []).concat(urls) }).eq("id", pid);
          if (error) throw error;
          document.dispatchEvent(new CustomEvent("postschanged", { detail: { id: pid, act: "media-added" } }));
        } catch (err) { alert(err.message || err); }
      };
      fi.click();
      return;
    }
    try {
      if (act === "archive" || act === "unarchive") await archivePost(pid, act === "archive");
      else if (act === "delete") {
        if (!confirm("Delete this post permanently?")) return;
        await deletePost(pid);
      }
      closePostMenu();
      document.dispatchEvent(new CustomEvent("postschanged", { detail: { id: pid, act: act } }));
    } catch (err) { alert(err.message || err); }
  });
}

function ytId(url) {
  if (!url) return null;
  const m = String(url).match(/(?:youtube\.com\/(?:watch\?[^#]*v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}
function spId(url) {
  if (!url) return null;
  const m = String(url).match(/open\.spotify\.com\/track\/([A-Za-z0-9]{22})|spotify:track:([A-Za-z0-9]{22})/);
  return m ? (m[1] || m[2]) : null;
}
function twitchInfo(url) {
  const u = String(url || "");
  let m = u.match(/clips\.twitch\.tv\/([A-Za-z0-9_-]+)/);
  if (m) return { clip: m[1], label: "Twitch clip" };
  m = u.match(/twitch\.tv\/([A-Za-z0-9_]+)\/clip\/([A-Za-z0-9_-]+)/);
  if (m) return { clip: m[2], channel: m[1], label: "Twitch clip" };
  m = u.match(/twitch\.tv\/videos\/(\d+)/);
  if (m) return { video: m[1], label: "Twitch video" };
  m = u.match(/twitch\.tv\/([A-Za-z0-9_]{4,25})(?:[/?#]|$)/);
  if (m && !/^(videos|clip|directory|downloads|jobs|turbo|prime|bits|subs|inventory|wallet|settings|search)$/i.test(m[1])) {
    return { channel: m[1], label: m[1] + " on Twitch" };
  }
  return null;
}
function musicBarHTML(post) {
  const src = post.music_source || "audius";
  if (src === "audius") {
    if (!post.music_stream_url) return "";
    return '<button class="musicbar" data-url="' + esc(post.music_stream_url) + '" data-start="' + (post.music_start_sec || 0) + '" data-dur="' + (post.music_duration_sec || "") + '" onclick="toggleMusic(this.dataset.url, this, parseFloat(this.dataset.start || 0), this.dataset.dur ? parseFloat(this.dataset.dur) : null)">' +
      '<span class="mstate">▶</span>' +
      '<span class="mtrack"><b>' + esc(post.music_title || "Unknown track") + "</b> · " + esc(post.music_artist || "Unknown artist") + "</span>" +
      '<span class="mlabel">Audius</span></button>';
  }
  // youtube: tap to play the video right inside the post
  if (src === "youtube") {
    const vid = ytId(post.music_external_url);
    if (!vid && !post.music_title) return "";
    const url = post.music_external_url || "";
    return '<div class="musicbar ext">' +
      '<span class="mstate">▶</span>' +
      '<span class="mtrack"><b>' + esc(post.music_title || "YouTube video") + "</b> · " + esc(post.music_artist || "YouTube") + "</span>" +
      (vid ? '<button class="mini-btn yt-play" data-vid="' + esc(vid) + '" data-url="' + esc(url) + '">Play</button>' : "") +
      (url ? ' <a class="mlabel" href="' + esc(url) + '" target="_blank" rel="noopener">YouTube ↗</a>' : "") +
      '<div class="yt-slot"></div></div>';
  }
  // spotify: tap for an inline 30-second preview (no login needed)
  if (src === "spotify") {
    const tid = spId(post.music_external_url);
    if (!post.music_external_url && !post.music_title) return "";
    return '<div class="musicbar ext">' +
      '<span class="mstate">♪</span>' +
      '<span class="mtrack"><b>' + esc(post.music_title || "Unknown track") + "</b> · " + esc(post.music_artist || "Unknown artist") + "</span>" +
      (tid ? '<button class="mini-btn sp-play" data-tid="' + esc(tid) + '">Preview</button>' : "") +
      (post.music_external_url ? ' <a class="mlabel" href="' + esc(post.music_external_url) + '" target="_blank" rel="noopener">Spotify ↗</a>' : "") +
      '<div class="sp-slot"></div></div>';
  }
  // apple: open the external track link in a new tab
  if (!post.music_external_url && !post.music_title) return "";
  const label = "Play on Apple Music";
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
    '<a class="brand" href="index.html"><img src="swan-logo.webp" alt="Swan"><span>Swan</span></a>' +
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
    // Make the id up front so we don't need insert().select() —
    // the select-back would trip the read policy before members are added.
    convId = (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID()
      : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
          const r = Math.random() * 16 | 0, v = c === "x" ? r : (r & 0x3 | 0x8);
          return v.toString(16);
        });
    const { error: cErr } = await sb.from("conversations").insert({ id: convId });
    if (cErr) throw cErr;
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

/* ============================================================
   Shared post card (feed + single-post page)
   ============================================================ */
let ME = null;
function setME(m) { ME = m; }

const SVG_LIKE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21.2l7.8-7.8 1-1a5.5 5.5 0 0 0 0-7.8z"/></svg>';
const SVG_COMMENT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>';

function mediaHTML(url) {
  if (isVideo(url)) return '<video src="' + esc(url) + '" controls playsinline preload="metadata"></video>';
  return '<img src="' + esc(url) + '" alt="post" loading="lazy">';
}

function domainOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch (e) { return ""; }
}

/* One slide inside a post carousel: photo, video, web link, YouTube, Spotify */
function slideInnerHTML(it) {
  if (it.kind === "youtube") {
    const vid = ytId(it.url);
    return '<div class="cs-yt" data-vid="' + esc(vid || "") + '" data-url="' + esc(it.url) + '">' +
      (vid ? '<img src="https://i.ytimg.com/vi/' + vid + '/hqdefault.jpg" alt="' + esc(it.title || "YouTube video") + '" loading="lazy">' : '<div class="cs-fallback">▶</div>') +
      '<span class="bigplay" aria-hidden="true">▶</span>' +
      '<div class="cs-meta"><b>' + esc(it.title || "YouTube video") + "</b><span>" + esc(it.subtitle || "YouTube") + "</span></div></div>";
  }
  if (it.kind === "spotify") {
    const tid = spId(it.url);
    return '<div class="cs-sp" data-tid="' + esc(tid || "") + '" data-url="' + esc(it.url) + '">' +
      (it.thumb ? '<img src="' + esc(it.thumb) + '" alt="' + esc(it.title || "Spotify track") + '" loading="lazy">' : '<div class="cs-fallback sp">♪</div>') +
      '<span class="bigplay" aria-hidden="true">▶</span>' +
      '<div class="cs-meta"><b>' + esc(it.title || "Spotify track") + "</b><span>" + esc(it.subtitle || "Spotify") + "</span></div></div>";
  }
  if (it.kind === "twitch") {
    const info = twitchInfo(it.url) || {};
    return '<div class="cs-tw" data-ch="' + esc(info.channel || "") + '" data-video="' + esc(info.video || "") +
      '" data-clip="' + esc(info.clip || "") + '" data-url="' + esc(it.url) + '">' +
      '<div class="cs-fallback tw">📺</div>' +
      '<span class="bigplay" aria-hidden="true">▶</span>' +
      '<div class="cs-meta"><b>' + esc(it.title || info.label || "Twitch") + "</b><span>" + esc(it.subtitle || "Twitch") + "</span></div></div>";
  }
  if (it.kind === "web") {
    const dom = domainOf(it.url);
    const fav = dom ? "https://www.google.com/s2/favicons?domain=" + encodeURIComponent(dom) + "&sz=128" : "";
    return '<a class="linkcard" href="' + esc(it.url) + '" target="_blank" rel="noopener">' +
      (fav ? '<img class="linkcard-fav" src="' + fav + '" alt="">' : '<span class="linkcard-fav">🌐</span>') +
      '<span class="grow"><b>' + esc(it.title || dom || "Web link") + "</b><span>" + esc(dom) + "</span></span>" +
      '<span class="mlabel">↗</span></a>';
  }
  if (it.kind === "video" || (!it.kind && isVideo(it.url))) {
    return '<video src="' + esc(it.url) + '" controls playsinline preload="metadata"></video>';
  }
  return '<img src="' + esc(it.url) + '" alt="post" loading="lazy">';
}

/* Swipeable carousel: uploaded media first, then link cards */
function slidesHTML(post) {
  const items = [];
  (post.media_urls || []).forEach(function (u) { if (u) items.push({ kind: isVideo(u) ? "video" : "image", url: u }); });
  (post.attachments || []).forEach(function (a) { if (a && a.url) items.push(a); });
  if (!items.length) return "";
  const multi = items.length > 1;
  let h = '<div class="carousel' + (multi ? " multi" : "") + '">';
  items.forEach(function (it) { h += '<div class="cslide">' + slideInnerHTML(it) + "</div>"; });
  h += "</div>";
  if (multi) {
    h += '<div class="cdots" aria-hidden="true">' + items.map(function (_, i) {
      return '<span class="' + (i === 0 ? "on" : "") + '"></span>';
    }).join("") + "</div>";
  }
  return h;
}

function cardHTML(post, author, likeCount, liked, comments, commentAuthors) {
  const pid = post.id;
  const isMine = ME && post.author_id === ME.id;
  let cmts = "";
  comments.forEach(function (c) {
    const a = commentAuthors[c.author_id] || { username: "?" };
    cmts += "<div><b>" + esc(a.username) + "</b> " + esc(c.body) + "</div>";
  });
  return '<article class="card" id="post-' + pid + '">' +
    '<div class="card-head">' +
      '<a href="profile.html?u=' + esc(author.username) + '">' + avatarHTML(author.avatar_url, author.username, 38) + "</a>" +
      '<div class="who"><a href="profile.html?u=' + esc(author.username) + '">' + esc(author.username) + '</a><div class="when">' + timeAgo(post.created_at) + (post.type === "reel" ? " · reel" : "") + "</div></div>" +
      (isMine ? '<button class="icon-btn post-menu-btn" data-post="' + pid + '" aria-label="Post options" style="margin-left:auto">···</button>' : "") +
    "</div>" +
    '<div class="card-media">' + slidesHTML(post) + "</div>" +
    musicBarHTML(post) +
    '<div class="card-actions">' +
      '<button class="action-btn like-btn' + (liked ? " liked" : "") + '" data-liked="' + (liked ? "1" : "0") + '" data-post="' + pid + '">' + SVG_LIKE + "</button>" +
      '<button class="action-btn" data-focus="cinput-' + pid + '">' + SVG_COMMENT + "</button>" +
    "</div>" +
    '<div class="likes-line" id="likes-' + pid + '">' + likeCount + " like" + (likeCount === 1 ? "" : "s") + "</div>" +
    (post.caption ? '<div class="caption-line"><b>' + esc(author.username) + "</b>" + esc(post.caption) + "</div>" : "") +
    '<div class="comments-preview" id="cprev-' + pid + '">' + cmts + "</div>" +
    '<div class="add-comment"><input id="cinput-' + pid + '" placeholder="Add a comment..." maxlength="300">' +
    '<button class="mini-btn" data-post="' + pid + '">Post</button></div>' +
  "</article>";
}

async function toggleLike(btn) {
  const pid = btn.dataset.post;
  const liked = btn.dataset.liked === "1";
  btn.disabled = true;
  try {
    if (liked) {
      const { error } = await sb.from("likes").delete().eq("user_id", ME.id).eq("post_id", pid);
      if (error) throw error;
      btn.dataset.liked = "0"; btn.classList.remove("liked");
    } else {
      const { error } = await sb.from("likes").insert({ user_id: ME.id, post_id: pid });
      if (error) throw error;
      btn.dataset.liked = "1"; btn.classList.add("liked");
    }
    const { count } = await sb.from("likes").select("*", { count: "exact", head: true }).eq("post_id", pid);
    const el = document.getElementById("likes-" + pid);
    if (el) el.textContent = (count || 0) + " like" + (count === 1 ? "" : "s");
  } catch (e) { alert("Could not update like: " + (e.message || e)); }
  btn.disabled = false;
}

async function addComment(pid) {
  const input = document.getElementById("cinput-" + pid);
  const body = input.value.trim();
  if (!body) return;
  try {
    const { error } = await sb.from("comments").insert({ post_id: pid, author_id: ME.id, body: body });
    if (error) throw error;
    input.value = "";
    const prev = document.getElementById("cprev-" + pid);
    const div = document.createElement("div");
    div.innerHTML = "<b>" + esc(ME.username) + "</b> " + esc(body);
    prev.appendChild(div);
  } catch (e) { alert("Could not post comment: " + (e.message || e)); }
}

/* Wire like / comment-focus / comment-submit / ··· buttons inside rendered cards */
function wirePostCard(root) {
  root.querySelectorAll(".like-btn").forEach(function (b) {
    b.addEventListener("click", function () { toggleLike(b); });
  });
  root.querySelectorAll(".action-btn[data-focus]").forEach(function (b) {
    b.addEventListener("click", function () {
      const inp = document.getElementById(b.dataset.focus);
      if (inp) inp.focus();
    });
  });
  root.querySelectorAll(".mini-btn[data-post]").forEach(function (b) {
    b.addEventListener("click", function () { addComment(b.dataset.post); });
  });
  root.querySelectorAll(".add-comment input").forEach(function (inp) {
    inp.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter") {
        const m = inp.id.match(/^cinput-(.+)$/);
        if (m) addComment(m[1]);
      }
    });
  });
  root.querySelectorAll(".post-menu-btn").forEach(function (b) {
    b.addEventListener("click", function () { openPostMenu(b.dataset.post, false); });
  });
}

/* Carousel dots follow the swipe */
document.addEventListener("scroll", function (e) {
  const t = e.target;
  if (!t || !t.classList || !t.classList.contains("carousel")) return;
  const idx = Math.round(t.scrollLeft / Math.max(1, t.clientWidth));
  const dots = t.parentElement ? t.parentElement.querySelectorAll(".cdots span") : [];
  dots.forEach(function (d, i) { d.classList.toggle("on", i === idx); });
}, true);

/* Inline play for carousel cards: YouTube + Spotify (no login needed) */
document.addEventListener("click", function (e) {
  const cy = e.target.closest(".cs-yt");
  if (cy) {
    if (!playYouTubeCard(cy) && cy.dataset.url) window.open(cy.dataset.url, "_blank");
    return;
  }
  const cs = e.target.closest(".cs-sp");
  if (cs) {
    if (cs.dataset.tid) {
      if (!cs.dataset.orig) cs.dataset.orig = cs.innerHTML;
      stopAllPlayback();
      cs.innerHTML = '<iframe src="https://open.spotify.com/embed/track/' + cs.dataset.tid +
        '?utm_source=generator&theme=0" allow="autoplay; encrypted-media" loading="lazy" style="width:100%;height:352px;border:none;display:block"></iframe>';
    } else if (cs.dataset.url) {
      window.open(cs.dataset.url, "_blank");
    }
    return;
  }
  const ct = e.target.closest(".cs-tw");
  if (ct) {
    const parent = location.hostname;
    let src = "";
    if (ct.dataset.clip) src = "https://clips.twitch.tv/embed?clip=" + encodeURIComponent(ct.dataset.clip) + "&parent=" + parent;
    else if (ct.dataset.video) src = "https://player.twitch.tv/?video=v" + encodeURIComponent(ct.dataset.video) + "&parent=" + parent;
    else if (ct.dataset.ch) src = "https://player.twitch.tv/?channel=" + encodeURIComponent(ct.dataset.ch) + "&parent=" + parent;
    if (!src) {
      if (ct.dataset.url) window.open(ct.dataset.url, "_blank");
      return;
    }
    if (!ct.dataset.orig) ct.dataset.orig = ct.innerHTML;
    stopAllPlayback();
    ct.innerHTML = '<iframe src="' + src + '" allowfullscreen style="width:100%;aspect-ratio:16/10;border:none;display:block"></iframe>';
  }
});
