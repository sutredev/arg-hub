// ===== Helpers =====
const RUNNER_PASSWORD = "whynot"; // used for secret gate as well
function $(sel){ return document.querySelector(sel); }
function logAction(action){
  const username = localStorage.getItem("username") || "guest";
  fetch("/api/log", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, action })
  }).catch(()=>{});
}
function requireAuth(){
  const role = localStorage.getItem("role");
  const user = localStorage.getItem("username");
  if (!role || !user) window.location.href = "index.html";
}
function setLogout(){
  const btn = document.getElementById("logout");
  if (btn) btn.addEventListener("click", (e)=>{
    e.preventDefault();
    localStorage.removeItem("role");
    localStorage.removeItem("username");
    window.location.href = "index.html";
  });
}

// ===== Login =====
const loginBtn = document.getElementById("loginBtn");
if (loginBtn){
  loginBtn.addEventListener("click", () => {
    const username = document.getElementById("username").value.trim();
    const password = document.getElementById("password").value;
    fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    })
    .then(r=>r.json())
    .then(d=>{
      if (d.success){
        localStorage.setItem("username", username);
        localStorage.setItem("role", d.role);
        if (d.role === "admin") {
          window.location.href = "admin.html";
        } else {
          window.location.href = "hub.html";
        }
      } else {
        document.getElementById("message").innerText = d.message || "login failed";
      }
    });
  });
}

// ===== Decay helpers =====
function fetchDecayStatus(username){
  return fetch(`/api/decay?username=${encodeURIComponent(username)}`).then(r=>r.json());
}
function incrementDecay(username){
  return fetch("/api/decay_increment", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username })
  }).then(r=>r.json());
}

// ===== Page boot =====
document.addEventListener("DOMContentLoaded", () => {
  setLogout();
  const path = location.pathname;
  if (path.endsWith("/hub.html") || path.endsWith("/gallery.html") || path.endsWith("/admin.html") || path.endsWith("/secret.html") || path.endsWith("/vault.html")){
    requireAuth();
  }
  // Auto-logs per page
  if (path.endsWith("/hub.html")) { logAction("entered hub"); bootHub(); }
  if (path.endsWith("/gallery.html")) { logAction("opened gallery"); bootGallery(); }
  if (path.endsWith("/admin.html")) { logAction("admin opened logs"); bootAdmin(); }
  if (path.endsWith("/vault.html")) { logAction("entered vault page"); }

  // If user in decay, increment decay_level on each page load (server-side)
  const user = localStorage.getItem("username");
  if (user) {
    fetchDecayStatus(user).then(d=>{
      if (d && d.decay_started){
        // increment decay level and then apply effects based on new level
        incrementDecay(user).then(r=>{
          const level = r.decay_level || d.decay_level || 0;
          applyDecay(level);
          // If level reached threshold and report unlocked will be marked server-side; refresh hub articles after short delay
          setTimeout(()=>{ if (location.pathname.endsWith('/hub.html')) bootHub(); }, 1200);
        }).catch(()=>{
          applyDecay(d.decay_level || 0);
        });
      }
    }).catch(()=>{});
  }
});

// ===== Hub logic =====
function bootHub(){
  const user = localStorage.getItem("username") || "runner";
  const hw = document.getElementById("user-welcome");
  if (hw) hw.textContent = `Welcome, ${user}.`;

  fetch(`/api/articles?username=${encodeURIComponent(user)}`).then(r=>r.json()).then(d=>{
    if (!d.success) return;
    const container = document.getElementById("posts");
    const archive = document.getElementById("archive");
    container.innerHTML = "";
    if (archive) archive.innerHTML = "";
    d.articles.forEach(p=>{
      const item = document.createElement("div");
      item.className = "post-item";
      const a = document.createElement("a");
      a.href = `/article/${encodeURIComponent(p.slug)}?username=${encodeURIComponent(user)}`;
      a.target = "_blank";
      a.textContent = p.title;
      a.addEventListener("click", (ev)=>{
        // record post open on server for decay trigger
        fetch("/api/post_open", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: user, slug: p.slug })
        }).then(()=>{});
        logAction(`opened post: ${p.slug}`);
      });
      item.appendChild(a);
      const small = document.createElement("span");
      small.className = "muted";
      small.textContent = `${p.type}${p.archived ? ' • archived' : ''}`;
      item.appendChild(small);

      if (p.visible && !p.archived) {
        // show in main feed
        container.appendChild(item);
      } else if (p.archived) {
        if (archive) archive.appendChild(item);
      }
    });
  });
}

// ===== Gallery logic =====
function bootGallery(){
  const user = localStorage.getItem("username") || "guest";
  fetch(`/api/user_images?username=${encodeURIComponent(user)}`).then(r=>r.json()).then(d=>{
    if (!d.success) return;
    const grid = document.getElementById("gallery");
    grid.innerHTML = "";
    d.images.forEach(name => {
      const w = document.createElement("div");
      w.className = "thumb-wrap";
      const i = document.createElement("img");
      i.className = "thumb";
      i.src = `/images/${encodeURIComponent(name)}`;
      i.alt = name;
      i.addEventListener("click", ()=> logAction(`opened image: ${name}`));
      w.appendChild(i);
      grid.appendChild(w);
    });
  });
}

// ===== Admin panel =====
function bootAdmin(){
  const admin = "admin";
  const pwd = "manas1234a!AB";
  fetch(`/api/admin/data?admin_username=${encodeURIComponent(admin)}&admin_password=${encodeURIComponent(pwd)}`)
    .then(r=>r.json()).then(d=>{
      if (!d.success) return;
      const artList = document.getElementById("admin-articles");
      artList.innerHTML = "";
      d.articles.forEach(a=>{
        const div = document.createElement("div");
        div.className = "post-item";
        div.innerHTML = `<strong>${a.title}</strong> <span class="muted">${a.slug} • ${a.type}</span>
          <div style="margin-top:6px"><button onclick="adminLoadArticle(${a.id})">edit</button>
          <button onclick="adminDeleteArticle(${a.id})">delete</button></div>`;
        artList.appendChild(div);
      });
      const users = document.getElementById("admin-users");
      users.innerHTML = "";
      d.users.forEach(u=>{
        const row = document.createElement("div");
        row.className = "post-item";
        row.innerHTML = `<strong>${u.username}</strong> <span class="muted">reads:${u.posts_read} decay:${u.decay_started}/${u.decay_level}</span>
          <div style="margin-top:6px"><button onclick="adminResetUser('${u.username}')">reset</button></div>`;
        users.appendChild(row);
      });
      const imgs = document.getElementById("admin-images");
      imgs.innerHTML = "";
      d.images.forEach(img=>{
        const row = document.createElement("div");
        row.className = "post-item";
        row.innerHTML = `${img.file} <span class="muted">available:${img.available}</span>
          <div style="margin-top:6px"><button onclick="adminToggleImage('${img.file}', ${img.available})">${img.available? 'revoke' : 'make available'}</button></div>`;
        imgs.appendChild(row);
      });
    });
}

function adminLoadArticle(id){
  const admin = "admin", pwd = "manas1234a!AB";
  fetch(`/api/admin/data?admin_username=${encodeURIComponent(admin)}&admin_password=${encodeURIComponent(pwd)}`)
    .then(r=>r.json()).then(d=>{
      const art = d.articles.find(x=>x.id===id);
      if (!art) return alert("not found");
      document.getElementById("art-id").value = art.id;
      document.getElementById("art-slug").value = art.slug;
      document.getElementById("art-title").value = art.title;
      document.getElementById("art-content").value = art.content;
      document.getElementById("art-type").value = art.type;
      document.getElementById("art-ordern").value = art.ordern || 0;
    });
}

function adminSaveArticle(){
  const admin = "admin", pwd = "manas1234a!AB";
  const id = document.getElementById("art-id").value || null;
  const slug = document.getElementById("art-slug").value.trim();
  const title = document.getElementById("art-title").value.trim();
  const content = document.getElementById("art-content").value;
  const type = document.getElementById("art-type").value;
  const ordern = parseInt(document.getElementById("art-ordern").value || "0");
  fetch("/api/admin/article_save", {
    method: "POST",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify({ admin_username: admin, admin_password: pwd, id, slug, title, content, type, ordern })
  }).then(r=>r.json()).then(d=>{
    if (d.success) {
      alert("saved");
      bootAdmin();
    } else alert("error");
  });
}

function adminDeleteArticle(id){
  if (!confirm("delete article?")) return;
  const admin = "admin", pwd = "manas1234a!AB";
  fetch("/api/admin/article_delete", {
    method: "POST", headers: {"Content-Type":"application/json"},
    body: JSON.stringify({ admin_username: admin, admin_password: pwd, id })
  }).then(r=>r.json()).then(d=>{ if (d.success) { alert("deleted"); bootAdmin(); } else alert("error"); });
}

function adminToggleImage(file, current){
  const admin = "admin", pwd = "manas1234a!AB";
  fetch("/api/admin/set_image_available", {
    method: "POST", headers: {"Content-Type":"application/json"},
    body: JSON.stringify({ admin_username: admin, admin_password: pwd, file: file, available: current ? 0 : 1 })
  }).then(()=>bootAdmin());
}

function adminResetUser(username){
  if (!confirm("reset user "+username+"?")) return;
  const admin = "admin", pwd = "manas1234a!AB";
  fetch("/api/admin/reset_user", {
    method: "POST", headers: {"Content-Type":"application/json"},
    body: JSON.stringify({ admin_username: admin, admin_password: pwd, username })
  }).then(()=>bootAdmin());
}

// ===== Secret key-sequence detection: 'befree' then password 'willnot' =====
let keyBuffer = "";
const SECRET_SEQ = "befree";
document.addEventListener("keydown", (e)=>{
  const user = localStorage.getItem("username");
  if (!user) return;
  keyBuffer += e.key.toLowerCase();
  if (keyBuffer.length > SECRET_SEQ.length) keyBuffer = keyBuffer.slice(-SECRET_SEQ.length);
  if (keyBuffer === SECRET_SEQ) {
    // show password prompt modal (simple prompt for now)
    const pw = prompt("A whisper asks for a word:");
    if (pw === null) return;
    if (pw === "willnot") {
      // unlock secret image for this user
      fetch("/api/unlock_image", {
        method: "POST", headers: {"Content-Type":"application/json"},
        body: JSON.stringify({ username: user, file: "secret.png" })
      }).then(r=>r.json()).then(d=>{
        if (d.success) {
          alert("A hidden image has been added to your gallery.");
          if (location.pathname.endsWith("/gallery.html")) bootGallery();
        } else alert("failed to unlock");
      });
    } else {
      alert("The word is wrong.");
    }
    keyBuffer = "";
  }
});

// ===== Admin logs view =====
function fetchAdminLogs(){
  const admin = "admin", pwd = "manas1234a!AB";
  fetch(`/api/admin/logs?admin_username=${encodeURIComponent(admin)}&admin_password=${encodeURIComponent(pwd)}`)
    .then(r=>r.json()).then(d=>{
      if (!d.success) return;
      const el = document.getElementById("logOutput");
      if (el) el.textContent = d.logs.map(l => `[${l.timestamp}] ${l.username} → ${l.action}`).join("\n");
    });
}

// ===== Secret gate (existing) =====
function unlockSecret(){
  const v = document.getElementById("gate").value;
  if (v === RUNNER_PASSWORD){
    document.getElementById("secretContent").style.display = "block";
    document.getElementById("secretMessage").textContent = "";
    logAction("unlocked secret");
  } else {
    document.getElementById("secretMessage").textContent = "wrong";
    logAction("failed secret attempt");
  }
}

// ===== Decay visuals (client-side only) =====
function applyDecay(level){
  if (level <= 0) return;
  document.body.classList.add("decay");
  const intensity = level <= 5 ? 1 : Math.max(0.2, 1 - (level - 5) * 0.08);

  // stronger: add CSS class for animation, and run JS flickers
  document.body.classList.add("decay-active");
  if (level <= 5) {
    fullChaos(intensity, level);
  } else {
    mildChaos(intensity, level);
  }
}

function fullChaos(intensity, level){
  // aggressive frequent flicker and image glitches
  doGlobalTextFlash();
  startTextFlicker(0.95, level);
  startImageGlitch(1.0);
  randomNavShake();
}

function mildChaos(intensity, level){
  startTextFlicker(0.35, level);
  startImageGlitch(0.35);
  // occasional small flashes
  if (Math.random() < 0.2) doGlobalTextFlash();
}

let flickerTimers = [];
function startTextFlicker(intensity, level){
  flickerTimers.forEach(t=>clearInterval(t));
  flickerTimers = [];
  const frequency = level <=5 ? 160 : 900;
  const duration = level <=5 ? 9000 : 4000;
  const runUntil = Date.now() + duration;
  const timer = setInterval(()=>{
    if (Date.now() > runUntil) { clearInterval(timer); return; }
    doRandomTextGlitch(Math.min(1,intensity));
  }, frequency);
  flickerTimers.push(timer);
}

function doRandomTextGlitch(intensity){
  const nodes = Array.from(document.querySelectorAll("h1, h2, p, a, .post-item .muted"));
  if (!nodes.length) return;
  const count = Math.max(1, Math.round(nodes.length * Math.min(0.6, intensity * 0.4)));
  for (let i=0;i<count;i++){
    const el = nodes[Math.floor(Math.random()*nodes.length)];
    const orig = el.innerText;
    const arr = orig.split("");
    for (let k=0;k<arr.length;k++){
      if (Math.random() < 0.12*intensity) arr[k] = randomGlitchChar();
    }
    const glitched = arr.join("");
    el.innerText = glitched;
    setTimeout(()=>{ try{ el.innerText = orig; } catch(e){} }, 300 + Math.random()*900);
  }
}

function randomGlitchChar(){
  const chars = "█▒░▓▌▐■▮▯";
  return chars[Math.floor(Math.random()*chars.length)];
}

function startImageGlitch(intensity){
  const imgs = Array.from(document.querySelectorAll("img.thumb"));
  imgs.forEach(img => {
    if (Math.random() < 0.45 * intensity){
      const clone = img.cloneNode();
      clone.style.position = "absolute";
      clone.style.left = (Math.random()*30-15) + "px";
      clone.style.top = (Math.random()*30-15) + "px";
      clone.style.opacity = 0.75;
      clone.style.filter = `contrast(${1+intensity*0.8}) saturate(${1+intensity*0.6}) hue-rotate(${Math.random()*360}deg) blur(${Math.random()*2}px)`;
      clone.className = "thumb glitch-clone";
      const parent = img.parentElement;
      parent.style.position = "relative";
      parent.appendChild(clone);
      setTimeout(()=>{ try{ clone.remove(); } catch(e){} }, 700 + Math.random()*1400);
    }
  });
}

function doGlobalTextFlash(){
  const f = document.createElement("div");
  f.style.position = "fixed";
  f.style.left = 0; f.style.top = 0; f.style.right = 0; f.style.bottom = 0;
  f.style.background = Math.random() < 0.5 ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.25)";
  f.style.pointerEvents = "none";
  f.style.mixBlendMode = "screen";
  document.body.appendChild(f);
  setTimeout(()=>{ f.remove(); }, 80 + Math.random()*320);
}

function randomNavShake(){
  const nav = document.querySelector(".topbar");
  if (!nav) return;
  nav.style.transform = "translateX(" + (Math.random()*12-6) + "px) rotate(" + (Math.random()*2-1) + "deg)";
  setTimeout(()=>{ nav.style.transform = ""; }, 700 + Math.random()*800);
}
