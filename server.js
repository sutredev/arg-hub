const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const bodyParser = require("body-parser");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;

// ===== Database =====
const db = new sqlite3.Database("./database.sqlite");
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT,
    action TEXT,
    timestamp TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS users (
    username TEXT PRIMARY KEY,
    posts_read INTEGER DEFAULT 0,
    decay_started INTEGER DEFAULT 0,
    decay_level INTEGER DEFAULT 0,
    report_unlock_level INTEGER DEFAULT 0
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS articles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT UNIQUE,
    title TEXT,
    content TEXT,
    type TEXT DEFAULT 'log', -- log, report, secret, generic
    ordern INTEGER DEFAULT 0
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS user_articles (
    username TEXT,
    article_id INTEGER,
    read INTEGER DEFAULT 0,
    archived INTEGER DEFAULT 0,
    unlocked INTEGER DEFAULT 0,
    PRIMARY KEY (username, article_id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS images (
    file TEXT PRIMARY KEY,
    available INTEGER DEFAULT 0
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS user_images (
    username TEXT,
    file TEXT,
    unlocked INTEGER DEFAULT 1,
    PRIMARY KEY (username, file)
  )`);

  // Insert default three story logs (if missing)
  const defaults = [
    { slug: 'log-1', title: 'First entry', content: `<h1>First entry</h1><p>I don't usually write these... kids at school call me names. It sticks. I keep small lists of things, habits that make it quieter.</p>`, type: 'log', ordern: 1 },
    { slug: 'log-2', title: 'Night noises', content: `<h1>Night noises</h1><p>There's a sound under the floor again. I told myself pipes, then thought of other things. I stop sleeping like I used to.</p>`, type: 'log', ordern: 2 },
    { slug: 'log-3', title: 'I will fix this', content: `<h1>I will fix this</h1><p>They won't stop. I will make them stop.</p>`, type: 'log', ordern: 3 },
    { slug: 'report-1', title: 'Report 1', content: `<h1>Report 1</h1><p>—</p>`, type: 'report', ordern: 10 }
  ];

  defaults.forEach(d => {
    db.get("SELECT id FROM articles WHERE slug = ?", [d.slug], (err,row) => {
      if (!row) {
        db.run("INSERT INTO articles (slug,title,content,type,ordern) VALUES (?,?,?,?,?)", [d.slug, d.title, d.content, d.type, d.ordern]);
      }
    });
  });

  // Ensure images table reflects files on disk
  const imagesDir = path.join(__dirname, "images");
  try {
    const files = fs.readdirSync(imagesDir).filter(f => ['.png','.jpg','.jpeg','.gif','.webp'].includes(path.extname(f).toLowerCase()));
    files.forEach(f => {
      db.run("INSERT OR IGNORE INTO images (file, available) VALUES (?, ?)", [f, 0]);
    });
  } catch(e) {}
});

// ===== Config =====
const RUNNER_PASSWORD = "whynot";
const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "manas1234a!AB";
const VAULT_PASSWORD = "FORFEITEDIHAVEMEMORIESLOSTGONEFOREVERLETSENJOYTHEEND";

// ===== Middleware =====
app.use(bodyParser.json({limit: '1mb'}));
app.use(express.static(path.join(__dirname, "public")));
app.use("/images", express.static(path.join(__dirname, "images")));

// ===== Helpers =====
function logEvent(username, action){
  const ts = new Date().toISOString();
  db.run("INSERT INTO logs (username, action, timestamp) VALUES (?, ?, ?)", [username || "guest", action, ts]);
}

// ===== Auth/Login =====
app.post("/api/login", (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.json({ success: false, message: "Missing credentials" });

  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    logEvent(username, 'admin login');
    return res.json({ success: true, role: "admin", username });
  }
  if (password === RUNNER_PASSWORD) {
    // Ensure user exists
    db.run("INSERT OR IGNORE INTO users (username) VALUES (?)", [username], (err) => {
      if (err) return res.json({ success: false, message: "DB error" });
      logEvent(username, "login");
      return res.json({ success: true, role: "runner", username });
    });
    return;
  }
  return res.json({ success: false, message: "Invalid credentials" });
});

// ===== Articles listing (user-aware) =====
app.get("/api/articles", (req, res) => {
  const username = req.query.username || null;
  db.all("SELECT * FROM articles ORDER BY ordern ASC, id ASC", [], (err, rows) => {
    if (err) return res.json({ success: false, error: "DB error" });
    if (!username) {
      // return basic list (logs visible)
      const out = rows.map(r => ({ id: r.id, slug: r.slug, title: r.title, type: r.type }));
      return res.json({ success: true, articles: out });
    }
    // join user_articles
    const q = `SELECT a.*, ua.read as u_read, ua.archived as u_archived, ua.unlocked as u_unlocked
               FROM articles a
               LEFT JOIN user_articles ua ON ua.article_id = a.id AND ua.username = ?
               ORDER BY a.ordern ASC, a.id ASC`;
    db.all(q, [username], (e, list) => {
      if (e) return res.json({ success: false, error: "DB error" });
      // compute visibility per rules: logs visible unless archived, secret/report only if unlocked
      const result = list.map(r => {
        let visible = true;
        if (r.type === 'secret' || r.type === 'report') {
          visible = !!r.u_unlocked;
        }
        if (r.type === 'log') {
          visible = !(r.u_archived);
        }
        return {
          id: r.id, slug: r.slug, title: r.title, type: r.type,
          read: !!r.u_read, archived: !!r.u_archived, unlocked: !!r.u_unlocked, visible
        };
      });
      res.json({ success: true, articles: result });
    });
  });
});

// ===== Serve article page (checks visibility) =====
app.get("/article/:slug", (req, res) => {
  const slug = req.params.slug;
  const username = req.query.username || null;
  db.get("SELECT * FROM articles WHERE slug = ?", [slug], (err, art) => {
    if (err || !art) return res.status(404).send("Not found");
    if (!username) {
      // only allow logs publicly; secrets/reports need username to check
      if (art.type === 'log') {
        return res.send(`<html><head><meta charset="utf-8"><title>${art.title}</title></head><body>${art.content}</body></html>`);
      } else {
        return res.status(403).send("Locked");
      }
    }
    // check user_articles for access
    db.get("SELECT * FROM user_articles WHERE username = ? AND article_id = ?", [username, art.id], (e, ua) => {
      let allowed = true;
      if (art.type === 'secret' || art.type === 'report') {
        allowed = !!(ua && ua.unlocked);
      }
      if (art.type === 'log') {
        allowed = !(ua && ua.archived);
      }
      if (!allowed) return res.status(403).send("Locked");
      // otherwise render
      // log that user opened it (server-side also)
      logEvent(username, `viewed article ${art.slug}`);
      res.send(`<html><head><meta charset="utf-8"><title>${art.title}</title></head><body>${art.content}</body></html>`);
    });
  });
});

// ===== Post open: increments posts_read, possibly triggers decay & archiving =====
app.post("/api/post_open", (req, res) => {
  const { username, slug } = req.body || {};
  if (!username || !slug) return res.json({ success: false, message: "Missing data" });
  db.serialize(() => {
    db.get("SELECT id FROM articles WHERE slug = ?", [slug], (err, art) => {
      if (err || !art) return res.json({ success: false, message: "Article not found" });
      const aid = art.id;
      db.run("INSERT OR IGNORE INTO users (username) VALUES (?)", [username]);
      db.get("SELECT posts_read, decay_started FROM users WHERE username = ?", [username], (er, urow) => {
        const prev = (urow && urow.posts_read) ? urow.posts_read : 0;
        const newCount = prev + 1;
        let decay = (urow && urow.decay_started) ? urow.decay_started : 0;
        // mark this article as read for this user
        db.run("INSERT OR REPLACE INTO user_articles (username, article_id, read, archived, unlocked) VALUES (?, ?, 1, COALESCE((SELECT archived FROM user_articles WHERE username=? AND article_id=?),0), COALESCE((SELECT unlocked FROM user_articles WHERE username=? AND article_id=?),0))",
               [username, aid, username, aid, username, aid]);
        if (!decay && newCount >= 3) {
          decay = 1;
          // set report_unlock_level to 6 (after decay increments to 6, report unlocks)
          db.run("UPDATE users SET posts_read = ?, decay_started = ?, report_unlock_level = ? WHERE username = ?", [newCount, decay, 6, username]);
          // archive the first three logs for this user (mark archived)
          db.all("SELECT id FROM articles WHERE type = 'log' ORDER BY ordern ASC LIMIT 3", [], (qerr, rows) => {
            if (!qerr && rows) {
              rows.forEach(r => {
                db.run("INSERT OR REPLACE INTO user_articles (username, article_id, read, archived, unlocked) VALUES (?, ?, COALESCE((SELECT read FROM user_articles WHERE username=? AND article_id=?),0), 1, COALESCE((SELECT unlocked FROM user_articles WHERE username=? AND article_id=?),0))", [username, r.id, username, r.id, username, r.id]);
              });
            }
            logEvent(username, `opened article ${slug}; posts_read=${newCount}; decay_started=${decay}`);
            res.json({ success: true, posts_read: newCount, decay_started: !!decay });
          });
        } else {
          db.run("UPDATE users SET posts_read = ? WHERE username = ?", [newCount, username], (uerr) => {
            logEvent(username, `opened article ${slug}; posts_read=${newCount}`);
            res.json({ success: true, posts_read: newCount, decay_started: !!decay });
          });
        }
      });
    });
  });
});

// ===== Decay endpoints =====
app.get("/api/decay", (req, res) => {
  const username = req.query.username;
  if (!username) return res.json({ success: false, message: "Missing username" });
  db.get("SELECT decay_started, decay_level, report_unlock_level FROM users WHERE username = ?", [username], (err, row) => {
    if (err) return res.json({ success: false, message: "DB error" });
    if (!row) return res.json({ success: true, decay_started: 0, decay_level: 0 });
    res.json({ success: true, decay_started: !!row.decay_started, decay_level: row.decay_level || 0, report_unlock_level: row.report_unlock_level || 0 });
  });
});

app.post("/api/decay_increment", (req, res) => {
  const username = req.body.username;
  if (!username) return res.json({ success: false, message: "Missing username" });
  db.run("UPDATE users SET decay_level = decay_level + 1 WHERE username = ?", [username], function(err) {
    if (err) return res.json({ success: false, message: "DB error" });
    db.get("SELECT decay_level, report_unlock_level FROM users WHERE username = ?", [username], (e, row) => {
      if (e) return res.json({ success: false, message: "DB error" });
      const level = row.decay_level || 0;
      const unlockAt = row.report_unlock_level || 0;
      // If reached unlockAt, unlock report-1 for this user
      if (unlockAt > 0 && level >= unlockAt) {
        db.get("SELECT id FROM articles WHERE slug = 'report-1'", [], (er, art) => {
          if (!er && art) {
            db.run("INSERT OR REPLACE INTO user_articles (username, article_id, read, archived, unlocked) VALUES (?, ?, COALESCE((SELECT read FROM user_articles WHERE username=? AND article_id=?),0), COALESCE((SELECT archived FROM user_articles WHERE username=? AND article_id=?),0), 1)",
                   [username, art.id, username, art.id, username, art.id]);
            logEvent(username, "report-1 unlocked");
          }
        });
      }
      res.json({ success: true, decay_level: level });
    });
  });
});

// ===== Images for a user =====
app.get("/api/user_images", (req, res) => {
  const username = req.query.username;
  if (!username) return res.json({ success: false, message: "Missing username" });
  // images available globally OR unlocked for user
  const q = `SELECT file FROM images WHERE available = 1
             UNION
             SELECT file FROM user_images WHERE username = ? AND unlocked = 1`;
  db.all(q, [username], (err, rows) => {
    if (err) return res.json({ success: false, message: "DB error" });
    res.json({ success: true, images: rows.map(r => r.file) });
  });
});

// Unlock an image for a user (used by secret & admin)
app.post("/api/unlock_image", (req, res) => {
  const { username, file, admin_username, admin_password } = req.body || {};
  if (!username || !file) return res.json({ success: false, message: "Missing data" });
  // check file exists
  const p = path.join(__dirname, "images", file);
  if (!fs.existsSync(p)) return res.json({ success: false, message: "Image not found" });
  db.run("INSERT OR REPLACE INTO user_images (username, file, unlocked) VALUES (?, ?, 1)", [username, file], function(err){
    if (err) return res.json({ success: false, message: "DB error" });
    logEvent(username, `image unlocked: ${file}`);
    res.json({ success: true });
  });
});

// Admin: set image available globally
app.post("/api/admin/set_image_available", (req, res) => {
  const { admin_username, admin_password, file, available } = req.body || {};
  if (admin_username !== ADMIN_USERNAME || admin_password !== ADMIN_PASSWORD) return res.json({ success: false, message: "Unauthorized" });
  db.run("INSERT OR IGNORE INTO images (file, available) VALUES (?, 0)", [file], (err) => {
    db.run("UPDATE images SET available = ? WHERE file = ?", [available ? 1 : 0, file], (e) => {
      res.json({ success: true });
    });
  });
});

// Admin: list images on disk and DB status
app.get("/api/admin/images", (req, res) => {
  const { admin_username, admin_password } = req.query || {};
  if (admin_username !== ADMIN_USERNAME || admin_password !== ADMIN_PASSWORD) return res.json({ success: false, message: "Unauthorized" });
  const imagesDir = path.join(__dirname, "images");
  try {
    const files = fs.readdirSync(imagesDir).filter(f => ['.png','.jpg','.jpeg','.gif','.webp'].includes(path.extname(f).toLowerCase()));
    db.all("SELECT file, available FROM images", [], (err, rows) => {
      const map = {};
      if (!err && rows) rows.forEach(r => map[r.file] = r.available);
      const out = files.map(f => ({ file: f, available: map[f] ? 1 : 0 }));
      res.json({ success: true, images: out });
    });
  } catch(e) {
    res.json({ success: false, message: "Read error" });
  }
});

// ===== Admin: articles CRUD =====
app.post("/api/admin/article_save", (req, res) => {
  const { admin_username, admin_password, id, slug, title, content, type, ordern } = req.body || {};
  if (admin_username !== ADMIN_USERNAME || admin_password !== ADMIN_PASSWORD) return res.json({ success: false, message: "Unauthorized" });
  if (!slug || !title) return res.json({ success: false, message: "Missing fields" });
  if (id) {
    db.run("UPDATE articles SET slug = ?, title = ?, content = ?, type = ?, ordern = ? WHERE id = ?", [slug, title, content, type || 'log', ordern || 0, id], (err) => {
      if (err) return res.json({ success: false, message: "DB error" });
      res.json({ success: true });
    });
  } else {
    db.run("INSERT INTO articles (slug, title, content, type, ordern) VALUES (?, ?, ?, ?, ?)", [slug, title, content, type || 'log', ordern || 0], (err) => {
      if (err) return res.json({ success: false, message: "DB error" });
      res.json({ success: true });
    });
  }
});

app.post("/api/admin/article_delete", (req, res) => {
  const { admin_username, admin_password, id } = req.body || {};
  if (admin_username !== ADMIN_USERNAME || admin_password !== ADMIN_PASSWORD) return res.json({ success: false, message: "Unauthorized" });
  db.run("DELETE FROM articles WHERE id = ?", [id], (err) => {
    if (err) return res.json({ success: false, message: "DB error" });
    db.run("DELETE FROM user_articles WHERE article_id = ?", [id], () => {
      res.json({ success: true });
    });
  });
});

app.get("/api/admin/data", (req, res) => {
  const { admin_username, admin_password } = req.query || {};
  if (admin_username !== ADMIN_USERNAME || admin_password !== ADMIN_PASSWORD) return res.json({ success: false, message: "Unauthorized" });
  db.serialize(() => {
    db.all("SELECT * FROM articles ORDER BY ordern ASC", [], (err, articles) => {
      db.all("SELECT username, posts_read, decay_started, decay_level FROM users", [], (e, users) => {
        db.all("SELECT file, available FROM images", [], (er, images) => {
          res.json({ success: true, articles, users, images });
        });
      });
    });
  });
});

// ===== Admin: reset user =====
app.post("/api/admin/reset_user", (req, res) => {
  const { admin_username, admin_password, username } = req.body || {};
  if (admin_username !== ADMIN_USERNAME || admin_password !== ADMIN_PASSWORD) return res.json({ success: false, message: "Unauthorized" });
  if (!username) return res.json({ success: false, message: "Missing username" });
  db.serialize(() => {
    db.run("UPDATE users SET posts_read = 0, decay_started = 0, decay_level = 0, report_unlock_level = 0 WHERE username = ?", [username]);
    db.run("DELETE FROM user_articles WHERE username = ?", [username]);
    db.run("DELETE FROM user_images WHERE username = ?", [username], () => {
      logEvent(admin_username, `reset user ${username}`);
      res.json({ success: true });
    });
  });
});

// ===== Vault check =====
app.get("/api/vault_check", (req, res) => {
  const pass = req.query.password || "";
  if (pass === VAULT_PASSWORD) return res.json({ success: true });
  res.json({ success: false });
});

// ===== Logs fetch for admin =====
app.get("/api/admin/logs", (req, res) => {
  const { admin_username, admin_password } = req.query || {};
  if (admin_username !== ADMIN_USERNAME || admin_password !== ADMIN_PASSWORD) return res.json({ success: false, message: "Unauthorized" });
  db.all("SELECT * FROM logs ORDER BY id DESC LIMIT 1000", [], (err, rows) => {
    if (err) return res.json({ success: false, message: "DB error" });
    res.json({ success: true, logs: rows });
  });
});

// ===== Start server =====
app.listen(PORT, () => {
  console.log(`ARG hub running on http://localhost:${PORT}`);
});
