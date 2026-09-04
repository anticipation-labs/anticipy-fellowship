var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
var __esm = (fn, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/schema.js
var COLUMNS;
var init_schema = __esm({
  "src/schema.js"() {
    COLUMNS = {
      fellows: ["id", "email", "name", "birth_month", "birth_year", "age_band", "country", "parent_email", "parental_consent", "consent_token_hash", "payout_identity_verified", "ad_usable", "instagram", "tiktok", "x_handle", "linkedin", "phone", "sms_opt_in", "fellowship", "waitlist_tracks", "status", "referral_code", "code_active", "code_revoked", "clicks_total", "session_hash", "session_expires", "payout_method", "payout_handle", "created", "updated", "email_confirmed_at", "ip_address", "welcome_sent_at", "payout_method_set_at", "lifetime_paid_usd", "youtube", "applied_ack_sent_at", "guardian_name", "guardian_email", "guardian_consent_at", "guardian_consent_ip", "guardian_terms_version", "guardian_token_hash"],
      fellow_codes: ["id", "email", "code_hash", "expires", "attempts", "used", "ip", "created"],
      fellow_applications: ["id", "fellow", "email", "fellowship", "answers", "ai_verdict", "ai_message", "ai_ok", "model", "terms_accepted_at", "created"],
      fellow_progress: ["id", "fellow", "lesson_id", "completed_at", "created"],
      fellow_clicks: ["id", "code", "ip_hash", "ua", "created"],
      fellow_conversions: ["id", "fellow", "code", "order_ref", "amount_usd", "commission_usd", "status", "flags", "source", "hold_until", "ship_confirmed_at", "paid_via", "entered_by", "created", "updated", "pay_after", "payout_key", "payout_attempts", "payout_claimed_at", "paid_at", "payout_ref", "review_reason", "payout_seq", "payout_blocked_on", "payout_checked_at"],
      fellow_payouts: ["id", "fellow", "batch", "total_usd", "method", "destination", "transfer_id", "status", "sent_at", "created", "conversion", "idempotency_key", "attempt", "amount_usd", "vendor", "vendor_order_id", "vendor_reward_id", "state", "http_status", "error", "product_id", "age_band_at_payment", "delivery", "finished_at"],
      fellow_meter: ["id", "name", "hour", "calls", "created", "updated"],
      fellow_submissions: ["id", "fellow", "platform", "kind", "url", "url_key", "submitted_url", "native_id", "author_handle", "author_claimed", "title", "thumbnail_url", "verify_state", "verified_at", "oembed_status", "status", "removed_by", "note", "flags", "created", "updated"]
    };
  }
});

// src/pb.js
var pb_exports = {};
__export(pb_exports, {
  App: () => App,
  Record: () => Record,
  filterToSQL: () => filterToSQL,
  newId: () => newId,
  pbNow: () => pbNow,
  sortToSQL: () => sortToSQL
});
function filterToSQL(filter, params = {}) {
  const binds = [];
  if (!filter || !filter.trim()) return { where: "1=1", binds };
  const clauses = filter.split("&&").map((s) => s.trim()).filter(Boolean);
  const sql = clauses.map((clause) => {
    const m = clause.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*(!=|<=|>=|=|<|>|~)\s*(.+)$/);
    if (!m) throw new Error("unsupported filter clause: " + clause);
    const [, field, op, rawValue] = m;
    const value = rawValue.trim();
    let bound;
    const pm = value.match(/^\{:([a-zA-Z_][a-zA-Z0-9_]*)\}$/);
    if (pm) {
      if (!(pm[1] in params)) throw new Error("missing filter param: " + pm[1]);
      bound = params[pm[1]];
    } else if (/^'.*'$/.test(value)) {
      bound = value.slice(1, -1);
    } else if (value === "true") {
      bound = 1;
    } else if (value === "false") {
      bound = 0;
    } else if (/^-?\d+(\.\d+)?$/.test(value)) {
      bound = Number(value);
    } else throw new Error("unsupported filter value: " + value);
    if (typeof bound === "boolean") bound = bound ? 1 : 0;
    if (op === "~") {
      binds.push("%" + bound + "%");
      return `${field} LIKE ?`;
    }
    binds.push(bound);
    return `${field} ${op === "!=" ? "!=" : op} ?`;
  }).join(" AND ");
  return { where: sql, binds };
}
function sortToSQL(sort) {
  if (!sort || !sort.trim()) return "";
  const parts = sort.split(",").map((s) => s.trim()).filter(Boolean).map((s) => {
    const dir = s.startsWith("-") ? "DESC" : "ASC";
    const field = s.replace(/^[-+]/, "");
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(field)) throw new Error("unsupported sort: " + s);
    return `${field} ${dir}`;
  });
  return " ORDER BY " + parts.join(", ");
}
function newId() {
  const bytes = crypto.getRandomValues(new Uint8Array(15));
  let s = "";
  for (const b of bytes) s += ALPHABET[b % ALPHABET.length];
  return s;
}
function pbNow() {
  return (/* @__PURE__ */ new Date()).toISOString().replace("T", " ").replace("Z", "Z");
}
function table(name) {
  if (!Object.prototype.hasOwnProperty.call(COLUMNS, name)) throw new Error("unknown collection: " + name);
  return name;
}
var Record, ALPHABET, App;
var init_pb = __esm({
  "src/pb.js"() {
    init_schema();
    __name(filterToSQL, "filterToSQL");
    __name(sortToSQL, "sortToSQL");
    Record = class {
      static {
        __name(this, "Record");
      }
      constructor(collection, data = {}) {
        this._collection = typeof collection === "string" ? collection : String(collection);
        this._data = { ...data };
        this._dirty = /* @__PURE__ */ new Set();
        if (!this._data.id) this._data.id = newId();
      }
      get id() {
        return this._data.id;
      }
      get(k) {
        return this._data[k];
      }
      getString(k) {
        const v = this._data[k];
        return v === null || v === void 0 ? "" : String(v);
      }
      getInt(k) {
        const n = parseInt(this._data[k], 10);
        return isNaN(n) ? 0 : n;
      }
      getFloat(k) {
        const n = parseFloat(this._data[k]);
        return isNaN(n) ? 0 : n;
      }
      getBool(k) {
        const v = this._data[k];
        return v === true || v === 1 || v === "1" || v === "true";
      }
      set(k, v) {
        this._data[k] = typeof v === "boolean" ? v ? 1 : 0 : v;
        this._dirty.add(k);
        return this;
      }
      toJSON() {
        return { ...this._data };
      }
    };
    ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
    __name(newId, "newId");
    __name(pbNow, "pbNow");
    App = class {
      static {
        __name(this, "App");
      }
      constructor(d1) {
        this.db = d1;
      }
      async findRecordsByFilter(collection, filter, sort = "", limit = 100, offset = 0, params = {}) {
        const { where, binds } = filterToSQL(filter, params);
        const sql = `SELECT * FROM ${table(collection)} WHERE ${where}${sortToSQL(sort)} LIMIT ? OFFSET ?`;
        const { results } = await this.db.prepare(sql).bind(...binds, limit, offset).all();
        return (results || []).map((row) => new Record(collection, row));
      }
      async findFirstRecordByFilter(collection, filter, params = {}) {
        const rows = await this.findRecordsByFilter(collection, filter, "", 1, 0, params);
        if (!rows.length) throw new Error("no rows");
        return rows[0];
      }
      // The hooks build records as `new Record(app.findCollectionByNameOrId("x"))`.
      // PocketBase returns a Collection object there; the only thing Record needs
      // from it is the name, so this returns the validated name and Record accepts
      // either. Validating here means a typo'd collection fails loudly at the call
      // site rather than producing a record that is silently never persisted.
      findCollectionByNameOrId(name) {
        return table(name);
      }
      async findRecordById(collection, id) {
        return this.findFirstRecordByFilter(collection, "id = {:id}", { id });
      }
      // Not every collection has both autodate fields — fellow_clicks has `created`
      // and no `updated`. PocketBase knows that from the collection definition;
      // here the table itself is asked, once per isolate. Writing a column that
      // does not exist makes the whole INSERT fail, and every caller of save() in
      // the hooks is wrapped in try/catch — so the failure is SILENT. That is how a
      // referral click gets redirected, counted as success, and credited to nobody.
      columns(collection) {
        const t = table(collection);
        const list = COLUMNS[t];
        if (!list) throw new Error("no column map for " + t + " \u2014 regenerate src/schema.js");
        return new Set(list);
      }
      async save(record) {
        const t = table(record._collection);
        const cols = this.columns(t);
        const now = pbNow();
        if (cols.has("created") && !record._data.created) {
          record._data.created = now;
          record._dirty.add("created");
        }
        if (cols.has("updated")) {
          record._data.updated = now;
          record._dirty.add("updated");
        }
        const existing = await this.db.prepare(`SELECT id FROM ${t} WHERE id = ?`).bind(record.id).first();
        if (existing) {
          const set = [...record._dirty].filter((c) => c !== "id" && cols.has(c));
          if (!set.length) return record;
          const sql = `UPDATE ${t} SET ${set.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`;
          await this.db.prepare(sql).bind(...set.map((c) => record._data[c]), record.id).run();
        } else {
          const ins = Object.keys(record._data).filter((c) => cols.has(c));
          const sql = `INSERT INTO ${t} (${ins.join(", ")}) VALUES (${ins.map(() => "?").join(", ")})`;
          await this.db.prepare(sql).bind(...ins.map((c) => record._data[c])).run();
        }
        record._dirty.clear();
        return record;
      }
      async delete(record) {
        await this.db.prepare(`DELETE FROM ${table(record._collection)} WHERE id = ?`).bind(record.id).run();
      }
    };
    __name(table, "table");
  }
});

// src/index.js
init_pb();

// src/runtime.js
function makeOs(env) {
  return { getenv: /* @__PURE__ */ __name((k) => env && env[k] != null ? String(env[k]) : "", "getenv") };
}
__name(makeOs, "makeOs");
var $security = {
  // The hooks hash tokens and emails before storing them. PocketBase returns
  // lowercase hex; WebCrypto returns bytes, so this converts.
  async sha256(s) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(s)));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  },
  // Constant-time. Used to check X-Internal-Key, so an early return on the
  // first differing byte would leak the key one character at a time.
  equal(a, b) {
    const x = String(a == null ? "" : a), y = String(b == null ? "" : b);
    if (x.length !== y.length) return false;
    let d = 0;
    for (let i = 0; i < x.length; i++) d |= x.charCodeAt(i) ^ y.charCodeAt(i);
    return d === 0;
  }
};
async function httpSend(opts) {
  const { url, method = "GET", body, headers = {}, timeout = 30 } = opts || {};
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout * 1e3);
  try {
    const res = await fetch(url, {
      method,
      headers,
      body: body === void 0 || method === "GET" || method === "HEAD" ? void 0 : body,
      signal: ctl.signal
    });
    const raw = await res.text();
    let json = null;
    try {
      json = JSON.parse(raw);
    } catch (_) {
    }
    return { statusCode: res.status, raw, json, headers: res.headers };
  } catch (e) {
    throw new Error("http send failed: " + e.message);
  } finally {
    clearTimeout(timer);
  }
}
__name(httpSend, "httpSend");
var RequestEvent = class {
  static {
    __name(this, "RequestEvent");
  }
  constructor(request, env, app, pathParams = {}) {
    this.request = wrapRequest(request);
    this.app = app;
    this.env = env;
    this._params = pathParams;
    this._body = null;
    this.response = null;
  }
  // e.requestInfo().body — PocketBase gives the parsed JSON body. The hooks all
  // guard with try/catch and default to {}, so a malformed body must not reject.
  requestInfo() {
    return { body: this._body || {}, query: this._query || {}, headers: this.request.header };
  }
  async _readBody() {
    try {
      this._body = await this.request._raw.clone().json();
    } catch (_) {
      this._body = {};
    }
    try {
      this._query = Object.fromEntries(new URL(this.request._raw.url).searchParams);
    } catch (_) {
      this._query = {};
    }
  }
  pathParam(k) {
    return this._params[k] || "";
  }
  // See fellowship.pb.js:119 — the FIRST entry of X-Forwarded-For is the client.
  // Behind Cloudflare that header is already client-first, and CF-Connecting-IP
  // is authoritative, so prefer it and fall back the way the hooks expect.
  realIP() {
    const cf = this.request.header.get("CF-Connecting-IP");
    if (cf) return cf;
    const xff = String(this.request.header.get("X-Forwarded-For") || "");
    return xff ? xff.split(",")[0].trim() : "";
  }
  json(status, data) {
    this.response = new Response(JSON.stringify(data), {
      status,
      headers: { "Content-Type": "application/json" }
    });
    return this.response;
  }
  html(status, body) {
    this.response = new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
    return this.response;
  }
  redirect(status, url) {
    this.response = new Response(null, { status, headers: { Location: url } });
    return this.response;
  }
  next() {
    return null;
  }
};
function wrapRequest(request) {
  const url = new URL(request.url);
  return {
    _raw: request,
    method: request.method,
    host: url.host,
    url: { path: url.pathname, query: url.search },
    header: { get: /* @__PURE__ */ __name((k) => request.headers.get(k) || "", "get") }
  };
}
__name(wrapRequest, "wrapRequest");
function createRouter() {
  const routes = [];
  const crons = [];
  return {
    routerAdd(method, pattern, handler) {
      routes.push({ method, pattern, handler, re: toRegex(pattern) });
    },
    cronAdd(name, expr, handler) {
      crons.push({ name, expr, handler });
    },
    match(method, pathname) {
      const want = method === "HEAD" ? "GET" : method;
      for (const r of routes) {
        if (r.method !== want) continue;
        const m = pathname.match(r.re.re);
        if (!m) continue;
        const params = {};
        r.re.keys.forEach((k, i) => {
          params[k] = decodeURIComponent(m[i + 1]);
        });
        return { handler: r.handler, params };
      }
      return null;
    },
    routes,
    crons
  };
}
__name(createRouter, "createRouter");
function toRegex(pattern) {
  const keys = [];
  const src = pattern.replace(/[.*+?^${}()|[\]\\]/g, (c) => c === "{" || c === "}" ? c : "\\" + c).replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (_, k) => {
    keys.push(k);
    return "([^/]+)";
  });
  return { re: new RegExp("^" + src + "$"), keys };
}
__name(toRegex, "toRegex");

// src/routes/fellowship.js
init_pb();
function register(r) {
  r.routerAdd("GET", "/fellows/health", async (e) => {
    const hasResend = !!e.os.getenv("RESEND_API_KEY");
    const hasModel = !!e.os.getenv("OPENROUTER_API_KEY");
    let realIP = "";
    try {
      const xff = String(e.request.header.get("X-Forwarded-For") || "");
      if (xff) realIP = xff.split(",")[0].trim();
    } catch (_) {
    }
    if (!realIP) {
      try {
        realIP = e.realIP() || "";
      } catch (_) {
      }
    }
    return e.json(200, {
      ok: true,
      can_email: hasResend,
      can_review: hasModel,
      // If this is false the per-IP throttle is disabled on purpose — see the
      // comment in /fellows/code. It is reported so the deploy checklist can be
      // verified from outside without a superuser login.
      ip_resolves: !!realIP && realIP !== "127.0.0.1" && realIP !== "::1"
    });
  });
  r.routerAdd("GET", "/r/{code}", async (e) => {
    const sha256 = /* @__PURE__ */ __name((s) => $security.sha256(s), "sha256");
    const site = e.os.getenv("ANTICIPY_SITE_URL") || "https://anticipy.ai";
    let raw = "";
    try {
      raw = String(e.pathParam("code") || "");
    } catch (_) {
    }
    if (!raw) {
      try {
        const path = String(e.request.url.path || "");
        const m = path.match(/\/r\/([^\/?#]+)/);
        if (m) raw = decodeURIComponent(m[1]);
      } catch (_) {
      }
    }
    raw = raw.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 24);
    const clean = /^[a-z0-9-]{4,24}$/.test(raw) ? raw : "";
    if (clean) {
      try {
        const fellow = await e.app.findFirstRecordByFilter("fellows", "referral_code = {:c}", { c: clean });
        if (fellow && !fellow.get("code_revoked")) {
          let ip = "";
          try {
            const xff = String(e.request.header.get("X-Forwarded-For") || "");
            if (xff) ip = xff.split(",")[0].trim();
          } catch (_) {
          }
          if (!ip) {
            try {
              ip = e.realIP() || "";
            } catch (_) {
            }
          }
          const salt = e.os.getenv("ANTICIPY_FELLOW_SALT") || "anticipy-fellows";
          const ipHash = ip ? await sha256(ip + salt) : "";
          let dupe = false;
          if (ipHash) {
            try {
              const recent = await e.app.findRecordsByFilter(
                "fellow_clicks",
                "code = {:c} && ip_hash = {:h}",
                "-created",
                1,
                0,
                { c: clean, h: ipHash }
              );
              if (recent[0]) {
                const t = Date.parse(String(recent[0].getString("created")).replace(" ", "T"));
                if (!isNaN(t) && Date.now() - t < 36e5) dupe = true;
              }
            } catch (_) {
            }
          }
          if (!dupe) {
            try {
              const c = new Record(e.app.findCollectionByNameOrId("fellow_clicks"));
              c.set("code", clean);
              c.set("ip_hash", ipHash);
              c.set("ua", String(e.request.header.get("User-Agent") || "").slice(0, 200));
              await e.app.save(c);
              fellow.set("clicks_total", (Number(fellow.get("clicks_total")) || 0) + 1);
              await e.app.save(fellow);
            } catch (_) {
            }
          }
        }
      } catch (_) {
      }
    }
    const url = site + "/?ref=" + encodeURIComponent(clean || "") + "&utm_source=fellow&utm_medium=referral&utm_campaign=" + encodeURIComponent(clean || "none");
    try {
      return e.redirect(302, url);
    } catch (_) {
      return e.html(
        200,
        '<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=' + url + '"><title>Anticipy</title><p>Taking you to Anticipy\u2026 <a href="' + url + '">tap here</a> if nothing happens.</p>'
      );
    }
  });
}
__name(register, "register");

// src/routes/identity.js
init_pb();

// src/hq.js
var missed = 0;
var warned = false;
async function writeActivity(app, fields) {
  try {
    const { Record: Record2 } = await Promise.resolve().then(() => (init_pb(), pb_exports));
    const rec = new Record2(app.findCollectionByNameOrId("internal_activity"));
    for (const [k, v] of Object.entries(fields)) rec.set(k, v);
    await app.save(rec);
    return true;
  } catch (err) {
    missed++;
    if (!warned) {
      warned = true;
      console.warn("HQ activity feed not present in D1 \u2014 activity rows are being dropped. This must be closed before cutover; see cloudflare/README.md.");
    }
    return false;
  }
}
__name(writeActivity, "writeActivity");

// src/routes/identity.js
var randomToken = /* @__PURE__ */ __name(() => {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(48));
  let out = "";
  for (const b of bytes) out += chars.charAt(b % chars.length);
  return out;
}, "randomToken");
var makeCode = /* @__PURE__ */ __name(() => {
  const chars = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  let out = "";
  for (const b of bytes) out += chars.charAt(b % chars.length);
  return out;
}, "makeCode");
var clientIP = /* @__PURE__ */ __name((e) => {
  let ip = "";
  try {
    const xff = String(e.request.header.get("X-Forwarded-For") || "");
    if (xff) ip = xff.split(",")[0].trim();
  } catch (_) {
  }
  if (!ip) {
    try {
      ip = e.realIP() || "";
    } catch (_) {
    }
  }
  return ip;
}, "clientIP");
var ageFrom = /* @__PURE__ */ __name((bm, by) => {
  const now = /* @__PURE__ */ new Date();
  let age = now.getUTCFullYear() - by;
  if (now.getUTCMonth() + 1 < bm) age -= 1;
  return age;
}, "ageFrom");
function register2(r) {
  r.routerAdd("POST", "/fellows/code", async (e) => {
    const sha256 = /* @__PURE__ */ __name((s) => $security.sha256(s), "sha256");
    const nowMs = Date.now();
    const nowISO = (/* @__PURE__ */ new Date()).toISOString();
    let body = {};
    try {
      body = e.requestInfo().body || {};
    } catch (_) {
    }
    const email = String(body.email || "").trim().toLowerCase();
    const bm = parseInt(body.birth_month, 10);
    const by = parseInt(body.birth_year, 10);
    const country = String(body.country || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 254) {
      return e.json(200, { ok: false, message: "That email doesn't look right. Mind checking it?" });
    }
    if (!(bm >= 1 && bm <= 12) || !(by >= 1900 && by <= 2100)) {
      return e.json(200, { ok: false, message: "Pick the month and year you were born and we'll carry on." });
    }
    const age = ageFrom(bm, by);
    if (age < 13) {
      return e.json(200, {
        ok: false,
        stop: true,
        message: "You have to be 13 to join this one. Come back on your birthday. We'll still be here, and we'd genuinely like to have you."
      });
    }
    if (country !== "us" && country !== "ca") {
      return e.json(200, {
        ok: false,
        stop: true,
        message: "Right now we can only take fellows in the US and Canada, because that's where we can pay people properly. We'll open it up. Leave us your email at anticipy.ai and we'll tell you when."
      });
    }
    const uniform = { ok: true, message: "Check your email. Your code is on the way." };
    try {
      const recent = await e.app.findRecordsByFilter(
        "fellow_codes",
        "email = {:em}",
        "-created",
        10,
        0,
        { em: email }
      );
      let lastMs = 0, inHour = 0;
      for (const row of recent) {
        const t = Date.parse(String(row.getString("created")).replace(" ", "T"));
        if (!isNaN(t)) {
          if (t > lastMs) lastMs = t;
          if (nowMs - t < 36e5) inHour++;
        }
      }
      if (lastMs && nowMs - lastMs < 6e4) return e.json(200, uniform);
      if (inHour >= 5) return e.json(200, uniform);
    } catch (_) {
    }
    const ip = clientIP(e);
    const ipUsable = ip && ip !== "127.0.0.1" && ip !== "::1";
    if (ipUsable) {
      try {
        const byIP = await e.app.findRecordsByFilter("fellow_codes", "ip = {:ip}", "-created", 20, 0, { ip });
        let n = 0;
        for (const row of byIP) {
          const t = Date.parse(String(row.getString("created")).replace(" ", "T"));
          if (!isNaN(t) && nowMs - t < 36e5) n++;
        }
        if (n >= 8) return e.json(200, uniform);
      } catch (_) {
      }
    }
    const ceiling = parseInt(e.os.getenv("ANTICIPY_FELLOW_EMAIL_CEILING") || "50", 10);
    const hourNow = nowISO.slice(0, 13);
    try {
      const meter = await e.app.findFirstRecordByFilter("fellow_meter", "name = 'email'");
      const used = meter.getString("hour") === hourNow ? Number(meter.get("calls")) || 0 : 0;
      if (used >= ceiling) {
        await writeActivity(e.app, {
          actor: "",
          actor_name: "Fellowships",
          action: "fellowship.email_meter",
          subject: "The fellowship sign-in email meter tripped at " + ceiling + "/hour"
        });
        return e.json(200, { ok: false, message: "We're getting a lot of signups right now. Try again in a few minutes." });
      }
      meter.set("hour", hourNow);
      meter.set("calls", used + 1);
      await e.app.save(meter);
    } catch (_) {
    }
    const code = String(1e5 + crypto.getRandomValues(new Uint32Array(1))[0] % 9e5);
    const rk = e.os.getenv("RESEND_API_KEY") || "";
    if (!rk) {
      return e.json(200, { ok: false, message: "We can't send codes this minute. Try again shortly. It's us, not you." });
    }
    let sent = false;
    try {
      const res = await httpSend({
        url: "https://api.resend.com/emails",
        method: "POST",
        headers: { "Authorization": "Bearer " + rk, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "Anticipy Fellowships <notifications@aevoy.com>",
          to: [email],
          subject: code + " is your Anticipy code",
          text: "Here's your code: " + code + "\n\nIt works for 10 minutes.\n\nIf you didn't ask for this, you can ignore this email. Nothing has been created."
        }),
        timeout: 20
      });
      sent = res.statusCode >= 200 && res.statusCode < 300;
    } catch (_) {
      sent = false;
    }
    if (!sent) {
      return e.json(200, { ok: false, message: "That email didn't go through. Check the address, or try again in a minute." });
    }
    try {
      const c = new Record(e.app.findCollectionByNameOrId("fellow_codes"));
      c.set("email", email);
      c.set("code_hash", await sha256(code));
      c.set("expires", new Date(nowMs + 10 * 6e4).toISOString());
      c.set("attempts", 0);
      c.set("used", false);
      c.set("ip", ipUsable ? ip : "");
      await e.app.save(c);
    } catch (_) {
    }
    return e.json(200, uniform);
  });
  r.routerAdd("POST", "/fellows/verify", async (e) => {
    const sha256 = /* @__PURE__ */ __name((s) => $security.sha256(s), "sha256");
    const nowMs = Date.now();
    let body = {};
    try {
      body = e.requestInfo().body || {};
    } catch (_) {
    }
    const email = String(body.email || "").trim().toLowerCase();
    const code = String(body.code || "").trim();
    const bm = parseInt(body.birth_month, 10);
    const by = parseInt(body.birth_year, 10);
    const country = String(body.country || "").trim().toLowerCase();
    if (!email || !/^\d{6}$/.test(code)) {
      return e.json(200, { ok: false, message: "That code doesn't look right. It's the six digits from the email." });
    }
    let row = null;
    try {
      const rows = await e.app.findRecordsByFilter(
        "fellow_codes",
        "email = {:em} && used = false",
        "-created",
        1,
        0,
        { em: email }
      );
      row = rows[0] || null;
    } catch (_) {
    }
    if (!row) return e.json(200, { ok: false, message: "That code isn't live any more. Ask for a fresh one and we'll start again." });
    const exp = Date.parse(row.getString("expires"));
    if (isNaN(exp) || nowMs > exp) {
      row.set("used", true);
      try {
        await e.app.save(row);
      } catch (_) {
      }
      return e.json(200, { ok: false, message: "That code expired. They only last ten minutes. Ask for a new one." });
    }
    const attempts = (Number(row.get("attempts")) || 0) + 1;
    row.set("attempts", attempts);
    if (attempts > 5) {
      row.set("used", true);
      try {
        await e.app.save(row);
      } catch (_) {
      }
      return e.json(200, { ok: false, message: "Too many tries on that code. Ask for a new one and we'll start again." });
    }
    try {
      await e.app.save(row);
    } catch (_) {
    }
    if (!$security.equal(await sha256(code), row.getString("code_hash"))) {
      return e.json(200, { ok: false, message: "That's not the code in the email. Try again." });
    }
    row.set("used", true);
    try {
      await e.app.save(row);
    } catch (_) {
    }
    const age = ageFrom(bm, by);
    if (!(bm >= 1 && bm <= 12) || !(by >= 1900 && by <= 2100) || age < 13) {
      return e.json(200, { ok: false, stop: true, message: "You have to be 13 to join this one. Come back on your birthday." });
    }
    const band = age >= 18 ? "18_plus" : age >= 16 ? "16_17" : "13_15";
    let fellow = null;
    try {
      fellow = await e.app.findFirstRecordByFilter("fellows", "email = {:em}", { em: email });
    } catch (_) {
    }
    if (!fellow) {
      try {
        fellow = new Record(e.app.findCollectionByNameOrId("fellows"));
        fellow.set("email", email);
        fellow.set("name", String(body.name || "").trim().slice(0, 120));
        fellow.set("birth_month", bm);
        fellow.set("birth_year", by);
        fellow.set("age_band", band);
        fellow.set("country", country === "ca" ? "ca" : "us");
        fellow.set("parental_consent", band === "18_plus" ? "not_required" : "pending");
        fellow.set("payout_method", "card");
        fellow.set("status", "new");
        fellow.set("clicks_total", 0);
        fellow.set("code_active", false);
        fellow.set("code_revoked", false);
        fellow.set("referral_code", makeCode());
        await e.app.save(fellow);
      } catch (err) {
        return e.json(200, { ok: false, message: "Something went wrong making your account. Try once more?" });
      }
    } else {
      fellow.set("age_band", band);
      if (!fellow.getString("referral_code")) fellow.set("referral_code", makeCode());
    }
    const token = randomToken();
    fellow.set("session_hash", await sha256(token));
    fellow.set("session_expires", new Date(nowMs + 30 * 864e5).toISOString());
    try {
      await e.app.save(fellow);
    } catch (_) {
    }
    return e.json(200, {
      ok: true,
      token,
      // returned exactly once
      fellow: {
        id: fellow.get("id"),
        email: fellow.getString("email"),
        name: fellow.getString("name"),
        age_band: fellow.getString("age_band"),
        country: fellow.getString("country"),
        parental_consent: fellow.getString("parental_consent"),
        fellowship: fellow.getString("fellowship"),
        status: fellow.getString("status"),
        referral_code: fellow.getString("referral_code"),
        code_active: !!fellow.get("code_active")
      }
    });
  });
  r.routerAdd("POST", "/fellows/start", async (e) => {
    const sha256 = /* @__PURE__ */ __name((s) => $security.sha256(s), "sha256");
    const nowMs = Date.now();
    let body = {};
    try {
      body = e.requestInfo().body || {};
    } catch (_) {
    }
    const email = String(body.email || "").trim().toLowerCase();
    const name = String(body.name || "").trim().slice(0, 120);
    const bm = parseInt(body.birth_month, 10);
    const by = parseInt(body.birth_year, 10);
    const country = String(body.country || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 254) {
      return e.json(200, { ok: false, field: "email", message: "That email doesn't look right." });
    }
    const domain = email.split("@")[1] || "";
    const BURNER = [
      "mailinator.com",
      "guerrillamail.com",
      "10minutemail.com",
      "tempmail.com",
      "yopmail.com",
      "trashmail.com",
      "sharklasers.com",
      "getnada.com",
      "temp-mail.org"
    ];
    if (BURNER.indexOf(domain) >= 0) {
      return e.json(200, {
        ok: false,
        field: "email",
        message: "We can't pay a throwaway address. Use one you'll still have in a month."
      });
    }
    if (!(bm >= 1 && bm <= 12) || !(by >= 1900 && by <= 2100)) {
      return e.json(200, { ok: false, field: "birth", message: "Pick the month and year you were born." });
    }
    const age = ageFrom(bm, by);
    if (age < 13) {
      return e.json(200, {
        ok: false,
        stop: true,
        message: "You have to be 13 to join this one. Come back on your birthday. We'll still be here, and we'd genuinely like to have you."
      });
    }
    if (country !== "us" && country !== "ca") {
      return e.json(200, {
        ok: false,
        stop: true,
        message: "Right now we can only take fellows in the US and Canada, because that's where we can pay people properly."
      });
    }
    const band = age >= 18 ? "18_plus" : age >= 16 ? "16_17" : "13_15";
    const ip = clientIP(e);
    if (ip && ip !== "127.0.0.1" && ip !== "::1") {
      try {
        const recent = await e.app.findRecordsByFilter("fellows", "ip_address = {:ip}", "-created", 30, 0, { ip });
        let n = 0;
        for (const row of recent) {
          const t = Date.parse(String(row.getString("created")).replace(" ", "T"));
          if (!isNaN(t) && nowMs - t < 36e5) n++;
        }
        if (n >= 6) {
          return e.json(200, {
            ok: false,
            message: "That's a lot of signups from one place. Give it an hour."
          });
        }
      } catch (_) {
      }
    }
    let fellow = null;
    try {
      fellow = await e.app.findFirstRecordByFilter("fellows", "email = {:em}", { em: email });
    } catch (_) {
    }
    const isNew = !fellow;
    if (fellow && fellow.getString("status") === "removed") {
      return e.json(200, {
        ok: false,
        message: "We can't set that up from here. Write to hello@anticipy.ai and a person will sort it."
      });
    }
    if (!fellow) {
      try {
        fellow = new Record(e.app.findCollectionByNameOrId("fellows"));
        fellow.set("email", email);
        fellow.set("birth_month", bm);
        fellow.set("birth_year", by);
        fellow.set("clicks_total", 0);
        fellow.set("code_revoked", false);
        fellow.set("referral_code", makeCode());
        fellow.set("ip_address", ip);
        fellow.set("payout_method", "card");
      } catch (_) {
        return e.json(200, { ok: false, message: "Something went wrong. Try once more?" });
      }
    }
    if (name) fellow.set("name", name);
    fellow.set("age_band", band);
    fellow.set("country", country === "ca" ? "ca" : "us");
    if (band === "18_plus") fellow.set("parental_consent", "not_required");
    else if (fellow.getString("parental_consent") !== "confirmed") fellow.set("parental_consent", "pending");
    if (!fellow.getString("status")) fellow.set("status", "new");
    if (isNew) fellow.set("code_active", false);
    const token = randomToken();
    fellow.set("session_hash", await sha256(token));
    fellow.set("session_expires", new Date(nowMs + 90 * 864e5).toISOString());
    try {
      await e.app.save(fellow);
    } catch (_) {
      return e.json(200, { ok: false, message: "Something went wrong saving that. Try once more?" });
    }
    await writeActivity(e.app, {
      actor: "",
      actor_name: "Fellowships",
      action: "fellow.started",
      subject: (name || email) + " started a fellowship application",
      ref: fellow.get("id")
    });
    return e.json(200, {
      ok: true,
      token,
      fellow: {
        id: fellow.get("id"),
        email,
        name: fellow.getString("name"),
        age_band: band,
        country: fellow.getString("country"),
        // These three were hard-coded, so a member who was already in came back
        // looking brand new to the client. The client branches on status; the
        // server has to tell it the truth for that to work.
        status: fellow.getString("status") || "new",
        fellowship: fellow.getString("fellowship") || "",
        referral_code: fellow.getString("referral_code"),
        code_active: !!fellow.get("code_active"),
        email_confirmed: !!fellow.getString("email_confirmed_at")
      }
    });
  });
  r.routerAdd("GET", "/fellows/confirm", async (e) => {
    const sha256 = /* @__PURE__ */ __name((s) => $security.sha256(s), "sha256");
    const fsite = e.os.getenv("ANTICIPY_FELLOWSHIP_URL") || "https://anticipyfellowship.com";
    let t = "";
    try {
      t = String(e.requestInfo().query.t || "");
    } catch (_) {
    }
    if (!t) return e.redirect(302, fsite + "/fellowships");
    let fellow = null;
    try {
      fellow = await e.app.findFirstRecordByFilter("fellows", "consent_token_hash = {:h}", { h: await sha256(t) });
    } catch (_) {
    }
    if (fellow) {
      fellow.set("email_confirmed_at", (/* @__PURE__ */ new Date()).toISOString());
      fellow.set("consent_token_hash", "");
      if (fellow.getString("age_band") === "18_plus") fellow.set("code_active", true);
      try {
        await e.app.save(fellow);
      } catch (_) {
      }
    }
    return e.redirect(302, fsite + "/fellowships?confirmed=1");
  });
}
__name(register2, "register");

// src/routes/dashboard.js
init_pb();

// src/session.js
async function requireFellow(e) {
  const token = e.request.header.get("X-Fellow-Token") || "";
  if (!token) return { fellow: null, deny: e.json(401, { reauth: true }) };
  let fellow = null;
  try {
    fellow = await e.app.findFirstRecordByFilter(
      "fellows",
      "session_hash = {:h}",
      { h: await $security.sha256(token) }
    );
  } catch (_) {
  }
  if (fellow && fellow.getString("status") === "removed") fellow = null;
  if (!fellow) return { fellow: null, deny: e.json(401, { reauth: true }) };
  const exp = Date.parse(fellow.getString("session_expires"));
  if (isNaN(exp) || Date.now() > exp) return { fellow: null, deny: e.json(401, { reauth: true }) };
  return { fellow, deny: null };
}
__name(requireFellow, "requireFellow");

// src/routes/dashboard.js
function register3(r) {
  r.routerAdd("GET", "/fellows/me", async (e) => {
    const { fellow, deny } = await requireFellow(e);
    if (deny) return deny;
    const bm = Number(fellow.get("birth_month")), by = Number(fellow.get("birth_year"));
    if (bm && by) {
      const now = /* @__PURE__ */ new Date();
      let age = now.getUTCFullYear() - by;
      if (now.getUTCMonth() + 1 < bm) age -= 1;
      const band = age >= 18 ? "18_plus" : age >= 16 ? "16_17" : "13_15";
      if (band !== fellow.getString("age_band")) {
        fellow.set("age_band", band);
        if (band === "18_plus" && fellow.getString("parental_consent") !== "confirmed") {
          fellow.set("parental_consent", "not_required");
        }
        try {
          await e.app.save(fellow);
        } catch (_) {
        }
      }
    }
    const done = [];
    try {
      const rows = await e.app.findRecordsByFilter("fellow_progress", "fellow = {:f}", "+created", 500, 0, { f: fellow.get("id") });
      for (const row of rows) done.push(row.getString("lesson_id"));
    } catch (_) {
    }
    const conversions = [];
    try {
      const rows = await e.app.findRecordsByFilter("fellow_conversions", "fellow = {:f}", "-created", 100, 0, { f: fellow.get("id") });
      for (const row of rows) conversions.push({
        status: row.getString("status"),
        commission_usd: Number(row.get("commission_usd")) || 0,
        created: row.getString("created"),
        hold_until: row.getString("hold_until")
      });
    } catch (_) {
    }
    const submissions = [];
    try {
      const rows = await e.app.findRecordsByFilter(
        "fellow_submissions",
        "fellow = {:f} && status != 'removed'",
        "-created",
        50,
        0,
        { f: fellow.get("id") }
      );
      for (const row of rows) submissions.push({
        id: row.get("id"),
        platform: row.getString("platform"),
        kind: row.getString("kind"),
        url: row.getString("url"),
        title: row.getString("title"),
        thumbnail_url: row.getString("thumbnail_url"),
        note: row.getString("note"),
        verify_state: row.getString("verify_state") === "gone" ? "gone" : "",
        created: row.getString("created")
      });
    } catch (_) {
    }
    return e.json(200, {
      ok: true,
      fellow: {
        id: fellow.get("id"),
        email: fellow.getString("email"),
        name: fellow.getString("name"),
        age_band: fellow.getString("age_band"),
        country: fellow.getString("country"),
        parental_consent: fellow.getString("parental_consent"),
        parent_email: fellow.getString("parent_email"),
        fellowship: fellow.getString("fellowship"),
        status: fellow.getString("status"),
        referral_code: fellow.getString("referral_code"),
        code_active: !!fellow.get("code_active"),
        clicks_total: Number(fellow.get("clicks_total")) || 0,
        instagram: fellow.getString("instagram"),
        tiktok: fellow.getString("tiktok"),
        x_handle: fellow.getString("x_handle"),
        linkedin: fellow.getString("linkedin"),
        // youtube joined the others in 1700000046. Without it a YouTube Short
        // could be logged and the author check would have nothing to compare
        // oEmbed's answer against, which is the same as having no check at all.
        youtube: fellow.getString("youtube"),
        payout_method: fellow.getString("payout_method"),
        sms_opt_in: !!fellow.get("sms_opt_in")
      },
      progress: done,
      conversions,
      submissions
    });
  });
  r.routerAdd("POST", "/fellows/progress", async (e) => {
    const { fellow, deny } = await requireFellow(e);
    if (deny) return deny;
    let body = {};
    try {
      body = e.requestInfo().body || {};
    } catch (_) {
    }
    let ids = [];
    if (Array.isArray(body.lessons)) ids = body.lessons;
    else if (body.lesson_id) ids = [body.lesson_id];
    ids = ids.map((x) => String(x || "").trim()).filter((x) => /^[a-z0-9-]{3,60}$/.test(x)).slice(0, 60);
    if (!ids.length) return e.json(200, { ok: true, saved: 0 });
    let count = 0;
    try {
      const existing = await e.app.findRecordsByFilter("fellow_progress", "fellow = {:f}", "+created", 500, 0, { f: fellow.get("id") });
      if (existing.length >= 500) return e.json(200, { ok: true, saved: 0 });
      const have = {};
      for (const row of existing) have[row.getString("lesson_id")] = true;
      const col = e.app.findCollectionByNameOrId("fellow_progress");
      for (const id of ids) {
        if (have[id]) continue;
        const rec = new Record(col);
        rec.set("fellow", fellow.get("id"));
        rec.set("lesson_id", id);
        rec.set("completed_at", (/* @__PURE__ */ new Date()).toISOString());
        try {
          await e.app.save(rec);
          count++;
        } catch (_) {
        }
      }
    } catch (_) {
    }
    return e.json(200, { ok: true, saved: count });
  });
  r.routerAdd("POST", "/fellows/profile", async (e) => {
    const { fellow, deny } = await requireFellow(e);
    if (deny) return deny;
    let body = {};
    try {
      body = e.requestInfo().body || {};
    } catch (_) {
    }
    const band = fellow.getString("age_band");
    if ("name" in body) fellow.set("name", String(body.name || "").trim().slice(0, 120));
    for (const k of ["instagram", "tiktok", "x_handle", "youtube"]) {
      if (k in body) fellow.set(k, String(body[k] || "").trim().replace(/^@/, "").slice(0, 200));
    }
    if ("linkedin" in body) {
      if (band === "13_15") return e.json(200, { ok: false, message: "LinkedIn's own rules start at 16, so we'll skip that one for now." });
      fellow.set("linkedin", String(body.linkedin || "").trim().slice(0, 200));
    }
    if ("phone" in body) {
      const ph = String(body.phone || "").trim().replace(/[\s()-]/g, "");
      if (ph && !/^\+?\d{8,15}$/.test(ph)) return e.json(200, { ok: false, message: "That number doesn't look right. Include the country code." });
      fellow.set("phone", ph);
    }
    if ("sms_opt_in" in body) {
      if (body.sms_opt_in === true && band !== "18_plus") {
        return e.json(200, { ok: false, message: "We only text fellows who are 18 or over. Email works for everything." });
      }
      fellow.set("sms_opt_in", body.sms_opt_in === true);
    }
    try {
      await e.app.save(fellow);
    } catch (_) {
      return e.json(200, { ok: false, message: "That didn't save. Try once more?" });
    }
    return e.json(200, { ok: true });
  });
}
__name(register3, "register");

// src/routes/apply.js
init_pb();
var token48 = /* @__PURE__ */ __name(() => {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(48));
  let out = "";
  for (const b of bytes) out += chars.charAt(b % chars.length);
  return out;
}, "token48");
function register4(r) {
  r.routerAdd("POST", "/fellows/apply", async (e) => {
    const { fellow, deny } = await requireFellow(e);
    if (deny) return deny;
    let body = {};
    try {
      body = e.requestInfo().body || {};
    } catch (_) {
    }
    const fellowship = String(body.fellowship || "growth").trim().toLowerCase();
    const TRACKS = { growth: 1, software: 1, hardware: 1, technical: 1 };
    if (!TRACKS[fellowship]) {
      return e.json(200, { ok: false, message: "We don't have that one. Pick one from the list." });
    }
    const technical = fellowship !== "growth";
    if (body.terms !== true) {
      return e.json(200, { ok: false, message: "Have a read of the terms and tick the box, then we'll carry on." });
    }
    const answers = body.answers && typeof body.answers === "object" ? body.answers : {};
    const flat = Object.keys(answers).map((k) => k + ": " + String(answers[k] || "").slice(0, 1200)).join("\n");
    if (flat.length > 8e3) return e.json(200, { ok: false, message: "That's a lot of words. Trim it a little and send again." });
    try {
      const prior = await e.app.findFirstRecordByFilter(
        "fellow_applications",
        "email = {:em} && fellowship = {:f} && ai_verdict != 'ask_more'",
        { em: fellow.getString("email"), f: fellowship }
      );
      if (prior) {
        return e.json(200, {
          ok: true,
          verdict: technical ? "received" : "accept",
          already: true,
          message: technical ? "We've already got this one. Nothing more to do. We'll write to you." : "You're already in. Head straight to the lessons.",
          fellow: {
            status: fellow.getString("status") || "accepted",
            fellowship: fellow.getString("fellowship") || fellowship,
            referral_code: fellow.getString("referral_code"),
            code_active: !!fellow.get("code_active"),
            age_band: fellow.getString("age_band"),
            name: fellow.getString("name")
          }
        });
      }
    } catch (_) {
    }
    const words = flat.replace(/\w+:/g, " ").trim().split(/\s+/).filter(Boolean);
    const realish = words.length >= 12 && /[aeiou]{1,}/i.test(flat) && !/^(.)\1+$/.test(flat.replace(/\s/g, ""));
    const firstName = String(fellow.getString("name") || "").trim().split(/\s+/)[0] || "there";
    let verdict = technical ? realish ? "received" : "ask_more" : realish ? "fallback_accept" : "ask_more";
    let message = verdict === "ask_more" ? technical ? "Give us a couple more real sentences, enough that there's something to read." : "Give us one more real sentence, just what you actually want out of this. That's genuinely all we need." : technical ? "Got it, " + firstName + ". A person reads this one, not a model, so it takes a few days rather than a few seconds." : "You're in, " + firstName + ". You said what you wanted out of this and that's the whole bar. The rest we teach you.";
    let modelUsed = "", aiOk = false;
    const orKey = e.os.getenv("OPENROUTER_API_KEY") || "";
    const ceiling = parseInt(e.os.getenv("ANTICIPY_FELLOW_LLM_CEILING") || "120", 10);
    const hourNow = (/* @__PURE__ */ new Date()).toISOString().slice(0, 13);
    let metered = false;
    try {
      if (technical) throw new Error("no model on this track");
      const meter = await e.app.findFirstRecordByFilter("fellow_meter", "name = 'llm'");
      const used = meter.getString("hour") === hourNow ? Number(meter.get("calls")) || 0 : 0;
      if (used < ceiling) {
        meter.set("hour", hourNow);
        meter.set("calls", used + 1);
        await e.app.save(meter);
        metered = true;
      }
    } catch (_) {
    }
    if (orKey && metered && !technical) {
      const model = e.os.getenv("ANTICIPY_FELLOW_MODEL") || "google/gemini-3.7-flash";
      const system = [
        "You read applications to a marketing fellowship at a tiny startup and reply to the applicant.",
        "The bar is LOW ON PURPOSE: anyone who wrote a real, honest answer gets in. We teach the rest.",
        "Reply 'ask_more' ONLY if the answers are empty, gibberish, keyboard-mash, or a joke, never because",
        "someone lacks experience, followers, or ambition. Having no experience is the normal case here.",
        "",
        "Write 2 or 3 sentences, to them, in plain words a 15-year-old reads without effort.",
        "Name something SPECIFIC they actually wrote. That is the whole point of reading it.",
        "Do not flatter. Do not say 'impressive' or 'passionate' or 'excited'. Do not mention money or",
        "earnings. Do not promise anything. No exclamation marks. Sentence case.",
        "Their first name is: " + firstName + ".",
        'Reply STRICT JSON: {"verdict":"accept"|"ask_more","message":"..."}'
      ].join("\n");
      try {
        const res = await httpSend({
          url: "https://openrouter.ai/api/v1/chat/completions",
          method: "POST",
          headers: {
            "Authorization": "Bearer " + orKey,
            "Content-Type": "application/json",
            "HTTP-Referer": "https://anticipy.ai",
            "X-Title": "Anticipy Fellowships"
          },
          body: JSON.stringify({
            model,
            temperature: 0.3,
            max_tokens: 2e3,
            response_format: { type: "json_object" },
            messages: [{ role: "system", content: system }, { role: "user", content: flat }]
          }),
          timeout: 14
          // the client no longer pads the wait, so this IS the wait
        });
        let text = "";
        try {
          text = res.json.choices[0].message.content || "";
        } catch (_) {
        }
        let parsed = null;
        try {
          parsed = JSON.parse(text);
        } catch (_) {
        }
        if (parsed && (parsed.verdict === "accept" || parsed.verdict === "ask_more") && parsed.message) {
          verdict = parsed.verdict === "ask_more" && realish ? "accept" : parsed.verdict;
          message = String(parsed.message).slice(0, 600);
          modelUsed = model;
          aiOk = true;
        }
      } catch (_) {
      }
    }
    try {
      const a = new Record(e.app.findCollectionByNameOrId("fellow_applications"));
      a.set("fellow", fellow.get("id"));
      a.set("email", fellow.getString("email"));
      a.set("fellowship", fellowship);
      a.set("answers", flat.slice(0, 8e3));
      a.set("ai_verdict", verdict);
      a.set("ai_message", message);
      a.set("ai_ok", aiOk);
      a.set("model", modelUsed);
      a.set("terms_accepted_at", (/* @__PURE__ */ new Date()).toISOString());
      await e.app.save(a);
    } catch (_) {
    }
    if (verdict === "ask_more") {
      try {
        fellow.set("status", "needs_more");
        await e.app.save(fellow);
      } catch (_) {
      }
      return e.json(200, { ok: true, verdict: "ask_more", message });
    }
    if (technical) {
      const already = fellow.getString("status") === "accepted";
      if (!already) {
        fellow.set("fellowship", fellowship);
        fellow.set("status", "applied");
      }
      try {
        await e.app.save(fellow);
      } catch (err) {
        return e.json(200, {
          ok: false,
          message: "We couldn't save that. Nothing's lost. Press it once more."
        });
      }
      const rkT = e.os.getenv("RESEND_API_KEY") || "";
      const siteT = e.os.getenv("ANTICIPY_FELLOWSHIP_URL") || "https://anticipyfellowship.com";
      const firstT = String(fellow.getString("name") || "").trim().split(/\s+/)[0];
      const TRACK_NAME = { software: "Software", hardware: "Hardware", technical: "Technical" };
      const trackName = TRACK_NAME[fellowship] || "Technical";
      if (rkT && !fellow.getString("applied_ack_sent_at")) {
        let sentT = false;
        try {
          const rT = await httpSend({
            url: "https://api.resend.com/emails",
            method: "POST",
            headers: { "Authorization": "Bearer " + rkT, "Content-Type": "application/json" },
            body: JSON.stringify({
              from: "Anticipy Fellowships <notifications@aevoy.com>",
              to: [fellow.getString("email")],
              // Transactional: the subject says what happened and not one word
              // more, because "you're in" would be a lie here.
              subject: firstT ? firstT + ", we've got your application" : "We've got your application",
              text: (firstT ? firstT + ", we've got it." : "We've got it.") + "\n\nYou applied to the " + trackName + " fellowship. A person reads these,\nnot a model, so give it a few days rather than a few seconds.\n\nIf it looks like a fit we'll write to set up a call. It's a conversation,\nnot a test, and there's nothing to prepare.\n\nOne thing worth saying plainly now: this track doesn't pay. There's no\nreferral link and no commission in it. What's on the other side is real\nwork on the product with us, and people who'll answer your questions.\n\nIf it isn't a fit we'll still write back and tell you.\n\n" + siteT + "/fellowships"
            }),
            timeout: 15
          });
          sentT = rT.statusCode >= 200 && rT.statusCode < 300;
        } catch (_) {
        }
        if (sentT) {
          fellow.set("applied_ack_sent_at", (/* @__PURE__ */ new Date()).toISOString());
          try {
            await e.app.save(fellow);
          } catch (_) {
          }
        }
      }
      await writeActivity(e.app, {
        actor: "",
        actor_name: "Fellowships",
        action: "fellow.applied",
        subject: (fellow.getString("name") || fellow.getString("email")) + " applied to the " + trackName + " fellowship, needs a person",
        ref: fellow.get("id")
      });
      return e.json(200, {
        ok: true,
        verdict: "received",
        message,
        // The row, not the request. A growth member who just applied to Software
        // is still `accepted` on `growth`.
        fellow: {
          status: fellow.getString("status"),
          fellowship: fellow.getString("fellowship"),
          applied_to: fellowship,
          name: fellow.getString("name"),
          age_band: fellow.getString("age_band")
        }
      });
    }
    fellow.set("fellowship", fellowship);
    fellow.set("status", "accepted");
    if (fellow.getString("age_band") === "18_plus") fellow.set("code_active", true);
    const rk2 = e.os.getenv("RESEND_API_KEY") || "";
    const site2 = e.os.getenv("ANTICIPY_FELLOWSHIP_URL") || "https://anticipyfellowship.com";
    const sell2 = e.os.getenv("ANTICIPY_SITE_URL") || "https://www.anticipy.ai";
    const first = String(fellow.getString("name") || "").trim().split(/\s+/)[0];
    let confirmRaw = "";
    if (!fellow.getString("email_confirmed_at")) {
      confirmRaw = token48();
      fellow.set("consent_token_hash", await $security.sha256(confirmRaw));
    }
    try {
      await e.app.save(fellow);
    } catch (err) {
      return e.json(200, {
        ok: false,
        message: "We couldn't save that. Nothing's lost. Press it once more."
      });
    }
    if (rk2 && !fellow.getString("welcome_sent_at")) {
      const confirmLine = confirmRaw ? "\n\nWhen you're ready to get paid, tap this once so we know the address is yours:\n" + site2 + "/fellows/confirm?t=" + confirmRaw : "";
      let sent = false;
      try {
        const res = await httpSend({
          url: "https://api.resend.com/emails",
          method: "POST",
          headers: { "Authorization": "Bearer " + rk2, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: "Anticipy Fellowships <notifications@aevoy.com>",
            to: [fellow.getString("email")],
            // CAN-SPAM: this is transactional — it confirms a relationship the
            // recipient initiated — so it is exempt from the opt-out and postal
            // address requirements. The subject line still may not mislead, and
            // "you're in" is only non-misleading if they are, in fact, in. The
            // save above is what makes that true.
            subject: first ? first + ", you're in" : "You're in",
            text: (first ? first + ", you're in." : "You're in.") + "\n\nStart here. Unit 0 is five minutes and it's just what this thing is.\n" + site2 + "/fellowship-growth-learning\n\nYour link, for when you start posting:\n" + sell2 + "/r/" + fellow.getString("referral_code") + "\n\n$30 when someone buys through it. One payment, 30 days after they buy,\nand we never take it back. The 30 days is the window where a purchase can\nstill be cancelled. We wait it out once rather than paying you in halves." + confirmLine + "\n\nThat's everything. Go make something."
          }),
          timeout: 15
        });
        sent = res.statusCode >= 200 && res.statusCode < 300;
      } catch (_) {
      }
      if (sent) {
        fellow.set("welcome_sent_at", (/* @__PURE__ */ new Date()).toISOString());
        try {
          await e.app.save(fellow);
        } catch (_) {
        }
      }
    }
    await writeActivity(e.app, {
      actor: "",
      actor_name: "Fellowships",
      action: "fellow.joined",
      subject: (fellow.getString("name") || fellow.getString("email")) + " joined the Growth fellowship",
      ref: fellow.get("id")
    });
    return e.json(200, {
      ok: true,
      verdict: "accept",
      message,
      fellow: {
        status: "accepted",
        fellowship,
        referral_code: fellow.getString("referral_code"),
        code_active: !!fellow.get("code_active"),
        age_band: fellow.getString("age_band")
      }
    });
  });
}
__name(register4, "register");

// src/lib/guardian-page.js
function renderGuardianPage(e, { fellow, first, already, raw, esc }) {
  const HEAD = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Anticipy: one step for a parent or guardian</title><link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' fill='%23FAF8F4'/%3E%3Ccircle cx='16' cy='16' r='7' fill='%23C8A97E'/%3E%3C/svg%3E"><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=Plus+Jakarta+Sans:wght@300;400;500;600&display=swap" rel="stylesheet"><style>:root{color-scheme:light;--ink:#171512;--ink-2:#6B665E;--paper:#FAF8F4;--paper-2:#F0EDE6;--rule-2:#D6D0C4;--rule-3:#B6AC99;--accent:#C8A97E;--accent-ink:#8A6B44;--accent-ink-2:#7E6140;--danger:#A33A3A;--ok:#2E6B4F;--field:#FFFFFF;--serif:'DM Serif Display',Georgia,serif;--sans:'Plus Jakarta Sans',-apple-system,BlinkMacSystemFont,sans-serif;--mono:ui-monospace,SFMono-Regular,Menlo,monospace}*{box-sizing:border-box;margin:0;padding:0}body{background:var(--paper);color:var(--ink);font:300 17px/1.7 var(--sans);letter-spacing:.01em;-webkit-font-smoothing:antialiased;padding:40px 24px 80px}main{max-width:620px;margin:0 auto}.dot{width:7px;height:7px;border-radius:50%;background:var(--accent);display:inline-block;margin-right:9px}.brand{font:400 15px/1 var(--serif)}.rule38{width:38px;height:2px;background:var(--accent);margin:26px 0 18px}h1{font:400 clamp(30px,5.4vw,44px)/1.05 var(--serif);letter-spacing:-.035em}p{margin-top:14px;max-width:34em}.small{font-size:15.5px;color:var(--ink-2);line-height:1.65}.tiny{font-size:13.5px;color:var(--ink-2);line-height:1.6;margin-top:10px}.eyebrow{font-family:var(--mono);font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--accent-ink);display:block;margin-bottom:14px}.card{background:var(--paper-2);border:1px solid var(--rule-2);border-radius:14px;padding:26px;margin-top:26px}.card .eyebrow{color:var(--accent-ink-2)}.rows{margin-top:8px;border-top:1px solid var(--rule-2)}.row{padding:13px 0;border-bottom:1px solid var(--rule-2);font-size:15.5px;line-height:1.55}.row b{font-weight:500}label{display:block;font-family:var(--mono);font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--accent-ink);margin:22px 0 6px}input[type=text],input[type=email]{background:transparent;border:0;border-bottom:1px solid var(--rule-2);color:var(--ink);padding:10px 0 12px;font:300 18px var(--sans);width:100%;outline:none;border-radius:0}input:focus{border-bottom-color:var(--accent-ink)}.check{display:flex;gap:12px;align-items:flex-start;margin-top:26px;background:var(--field);border:1px solid var(--rule-3);border-radius:10px;padding:16px}.check input{margin-top:4px;width:18px;height:18px;flex:none;accent-color:var(--accent-ink)}.check span{font-size:15px;line-height:1.55}.btn{display:inline-flex;align-items:center;justify-content:center;gap:10px;background:var(--ink);color:var(--paper);border:0;border-radius:999px;padding:17px 34px;font:600 16.5px/1 var(--sans);cursor:pointer;margin-top:26px;width:100%;text-decoration:none}.btn:disabled{opacity:.55;cursor:default}.msg{margin-top:12px;font-size:14.5px;min-height:20px;color:var(--ink-2)}.msg.err{color:var(--danger)}.msg.ok{color:var(--ok)}:focus-visible{outline:2px solid var(--accent-ink);outline-offset:3px}a{color:var(--accent-ink)}</style></head><body><main><span class="brand"><span class="dot"></span>Anticipy</span>`;
  const FOOT = "</main></body></html>";
  if (!fellow) {
    return e.html(200, HEAD + '<div class="rule38"></div><h1>This link has expired.</h1><p class="small">Guardian links are single-use and a new one replaces the last. Ask the person who sent it to open their fellowship page and tap <b>Get the link for my parent</b> again. It takes them a second.</p><p class="small">Nothing is lost, and nothing is wrong with their account.</p><p class="tiny">If you think you got this in error, write to <a href="mailto:hello@anticipy.ai">hello@anticipy.ai</a>.</p>' + FOOT);
  }
  if (already) {
    return e.html(200, HEAD + '<div class="rule38"></div><h1>Already done.</h1><p class="small">' + esc(first) + "&rsquo;s payouts are switched on. There is nothing further for you to do, and we won&rsquo;t email you again about it.</p>" + FOOT);
  }
  return e.html(200, HEAD + '<div class="rule38"></div><span class="eyebrow">One step, about two minutes</span><h1>' + esc(first) + ' joined the Anticipy fellowship.</h1><p>They&rsquo;re learning how short video actually works, and everything in the course is already open to them. The only thing waiting on you is <b>getting paid</b>. That&rsquo;s the law about paying under-18s, not a rule of ours.</p><div class="card"><span class="eyebrow">What this is</span><div class="rows"><div class="row"><b>What they do.</b> Make short videos about Anticipy on their own accounts, if they want to. Posting is always optional and there is no quota and no deadline.</div><div class="row"><b>What they earn.</b> $30 when somebody buys through their link. One payment, 30 days after the purchase, and we never take it back.</div><div class="row"><b>How it arrives.</b> A prepaid Visa card, sent to the email address you give below. No bank account and no ID is needed from your child. That is the whole reason we pay this way.</div><div class="row"><b>What we don&rsquo;t ask for.</b> No social security number, no bank details, no photo, no address, no school.</div></div></div><label for="g-name">Your full name</label><input type="text" id="g-name" autocomplete="name" placeholder="Alex Rivera"><label for="g-email">Your email: this is where the card is sent</label><input type="email" id="g-email" autocomplete="email" inputmode="email" placeholder="you@example.com"><div class="check"><input type="checkbox" id="g-affirm"><span>I am ' + esc(first) + '&rsquo;s parent or legal guardian, I am over 18, and I accept these terms both on their behalf and in my own name as the person the money is paid to. I understand the reward is taxable income and that Anticipy does not give tax advice.</span></div><button class="btn" id="g-go">Switch on ' + esc(first) + '&rsquo;s payouts</button><div class="msg" id="g-msg" role="status"></div><p class="tiny">We keep your name, your email, the date, and which version of these terms you agreed to. That is all, and it is only so we can show this step happened. Questions: <a href="mailto:hello@anticipy.ai">hello@anticipy.ai</a>.</p><script>var T=' + JSON.stringify(raw) + `;function $(i){return document.getElementById(i)}function say(t,k){var m=$("g-msg");m.textContent=t||"";m.className="msg"+(t&&k?" "+k:"")}$("g-go").addEventListener("click",function(){var n=$("g-name").value.trim(),em=$("g-email").value.trim(),a=$("g-affirm").checked;if(!n)return say("We need your name.","err");if(!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}$/.test(em))return say("That email doesn't look right.","err");if(!a)return say("Please tick the box. It's the part that actually counts.","err");var b=this;b.disabled=true;b.textContent="One moment\u2026";say("");fetch("/fellows/guardian",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({t:T,guardian_name:n,guardian_email:em,affirm:true})}).then(function(r){return r.json()}).then(function(j){if(!j||!j.ok){b.disabled=false;b.textContent="Try that again";return say((j&&j.message)||"That didn't work.","err")}document.querySelector("main").innerHTML='<span class="brand"><span class="dot"></span>Anticipy</span><div class="rule38"></div>'+'<h1>Done. Thank you.</h1><p class="small">'+j.message+'</p>';}).catch(function(){b.disabled=false;b.textContent="Try that again";say("We couldn't reach our end. Try once more.","err")});});<\/script>` + FOOT);
}
__name(renderGuardianPage, "renderGuardianPage");

// src/routes/guardian.js
var GUARDIAN_TERMS_VERSION = "2026-08-22";
var token482 = /* @__PURE__ */ __name(() => {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(48));
  let out = "";
  for (const b of bytes) out += chars.charAt(b % chars.length);
  return out;
}, "token48");
function register5(r) {
  r.routerAdd("POST", "/fellows/guardian/link", async (e) => {
    const fsite = e.os.getenv("ANTICIPY_FELLOWSHIP_URL") || "https://anticipyfellowship.com";
    const { fellow, deny } = await requireFellow(e);
    if (deny) return deny;
    if (fellow.getString("age_band") === "18_plus") {
      return e.json(200, { ok: false, message: "You're 18 or over, so there's no guardian step." });
    }
    if (fellow.getString("parental_consent") === "confirmed") {
      return e.json(200, {
        ok: true,
        done: true,
        message: "Already done. " + (fellow.getString("guardian_name") || "your guardian") + " completed this."
      });
    }
    const raw = token482();
    fellow.set("guardian_token_hash", await $security.sha256(raw));
    try {
      await e.app.save(fellow);
    } catch (_) {
      return e.json(200, { ok: false, message: "Couldn't make that link. Try once more?" });
    }
    return e.json(200, { ok: true, url: fsite + "/fellows/guardian?t=" + raw });
  });
  r.routerAdd("GET", "/fellows/guardian", async (e) => {
    const esc = /* @__PURE__ */ __name((s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"), "esc");
    let raw = "";
    try {
      raw = String(e.requestInfo().query.t || "");
    } catch (_) {
    }
    raw = raw.replace(/[^A-Za-z0-9]/g, "").slice(0, 64);
    let fellow = null;
    if (raw) {
      try {
        fellow = await e.app.findFirstRecordByFilter(
          "fellows",
          "guardian_token_hash = {:h}",
          { h: await $security.sha256(raw) }
        );
      } catch (_) {
      }
    }
    if (fellow && fellow.getString("status") === "removed") fellow = null;
    const first = fellow ? String(fellow.getString("name") || "").trim().split(/\s+/)[0] || "your child" : "";
    const already = fellow && fellow.getString("parental_consent") === "confirmed";
    return renderGuardianPage(e, { fellow, first, already, raw, esc });
  });
  r.routerAdd("POST", "/fellows/guardian", async (e) => {
    let body = {};
    try {
      body = e.requestInfo().body || {};
    } catch (_) {
    }
    const raw = String(body.t || "").replace(/[^A-Za-z0-9]/g, "").slice(0, 64);
    const name = String(body.guardian_name || "").trim().slice(0, 120);
    const email = String(body.guardian_email || "").trim().toLowerCase().slice(0, 254);
    if (!raw) return e.json(200, { ok: false, message: "That link is missing something. Ask for a fresh one." });
    if (!name) return e.json(200, { ok: false, message: "We need your name." });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      return e.json(200, { ok: false, message: "That email doesn't look right." });
    }
    if (body.affirm !== true) {
      return e.json(200, { ok: false, message: "Please tick the box. It's the part that actually counts." });
    }
    let fellow = null;
    try {
      fellow = await e.app.findFirstRecordByFilter(
        "fellows",
        "guardian_token_hash = {:h}",
        { h: await $security.sha256(raw) }
      );
    } catch (_) {
    }
    if (fellow && fellow.getString("status") === "removed") fellow = null;
    if (!fellow) return e.json(200, { ok: false, message: "That link has expired. Ask for a fresh one." });
    if (fellow.getString("age_band") === "18_plus") {
      return e.json(200, { ok: false, message: "This account doesn't need a guardian step." });
    }
    if (fellow.getString("parental_consent") === "confirmed") {
      return e.json(200, { ok: true, message: "This was already done. Nothing further is needed." });
    }
    let ip = "";
    try {
      const xff = String(e.request.header.get("X-Forwarded-For") || "");
      if (xff) ip = xff.split(",")[0].trim();
    } catch (_) {
    }
    if (!ip) {
      try {
        ip = e.realIP() || "";
      } catch (_) {
      }
    }
    fellow.set("guardian_name", name);
    fellow.set("guardian_email", email);
    fellow.set("guardian_consent_at", (/* @__PURE__ */ new Date()).toISOString());
    fellow.set("guardian_consent_ip", ip);
    fellow.set("guardian_terms_version", GUARDIAN_TERMS_VERSION);
    fellow.set("parental_consent", "confirmed");
    fellow.set("code_active", true);
    if (!fellow.getString("payout_method")) fellow.set("payout_method", "card");
    fellow.set("guardian_token_hash", "");
    try {
      await e.app.save(fellow);
    } catch (_) {
      return e.json(200, { ok: false, message: "We couldn't save that. Nothing's lost. Press it once more." });
    }
    await writeActivity(e.app, {
      actor: "",
      actor_name: "Fellowships",
      action: "fellow.guardian_confirmed",
      subject: name + " confirmed guardianship for " + (fellow.getString("name") || fellow.getString("email")),
      ref: fellow.get("id")
    });
    const first = String(fellow.getString("name") || "").trim().split(/\s+/)[0] || "They";
    return e.json(200, {
      ok: true,
      message: first + "'s payouts are switched on. When something they make sells one, the card comes to " + email + " thirty days later. There is nothing else for you to do."
    });
  });
}
__name(register5, "register");

// src/routes/payouts.js
function bandOf(fellow) {
  let band = fellow.getString("age_band") || "";
  const bm = Number(fellow.get("birth_month")), by = Number(fellow.get("birth_year"));
  if (bm && by) {
    const d = /* @__PURE__ */ new Date();
    let age = d.getUTCFullYear() - by;
    if (d.getUTCMonth() + 1 < bm) age -= 1;
    band = age >= 18 ? "18_plus" : age >= 16 ? "16_17" : "13_15";
  }
  return band;
}
__name(bandOf, "bandOf");
function register6(r) {
  r.routerAdd("GET", "/fellows/payouts/health", async (e) => {
    const key = e.os.getenv("TREMENDOUS_API_KEY") || "";
    const prod = String(e.os.getenv("TREMENDOUS_ENV") || "").trim().toLowerCase() === "production";
    const vendorSet = (e.os.getenv("ANTICIPY_PAYOUT_VENDOR") || "").trim().toLowerCase();
    let status = "ready";
    if (!key) status = "not_configured";
    else if (prod && key.indexOf("TEST_") === 0) status = "misconfigured";
    else if (!prod && key.indexOf("PROD_") === 0) status = "misconfigured";
    return e.json(200, {
      ok: true,
      // Never the vendor's name to the public. This says WHAT the rail is, not WHO.
      rail: "stored_value",
      // Sandbox is the default and this reports it, so nobody discovers on payday
      // that the deploy has been spending fake money for a fortnight.
      env: prod ? "production" : "sandbox",
      configured: !!key,
      status,
      can_send: status === "ready",
      // Under-18 sends stay off until the vendor answers about recipient age in
      // writing. Reported so the answer arriving is a config change somebody can
      // verify, not a thing somebody remembers.
      can_send_under_18: status === "ready" && !!vendorSet
    });
  });
  r.routerAdd("POST", "/fellows/payout-method", async (e) => {
    const { fellow, deny } = await requireFellow(e);
    if (deny) return deny;
    let body = {};
    try {
      body = e.requestInfo().body || {};
    } catch (_) {
    }
    const method = String(body.method || "").trim().toLowerCase();
    if (method !== "card" && method !== "cash_like") {
      return e.json(200, {
        ok: false,
        field: "method",
        message: "Pick one: a prepaid card by email, or a transfer."
      });
    }
    const band = bandOf(fellow);
    if (method === "cash_like" && band !== "18_plus") {
      return e.json(200, {
        ok: false,
        field: "method",
        message: "A transfer needs a PayPal or bank account, and a company can't open one of those with someone under 18, so that option isn't ours to offer yet. The card is the same $30, by email, and there's nothing to set up."
      });
    }
    if (method === "cash_like" && !(e.os.getenv("TREMENDOUS_PRODUCT_CASH_LIKE") || "").trim()) {
      return e.json(200, {
        ok: false,
        field: "method",
        message: "Transfers aren't switched on yet, so the only thing we could actually send you is the card, and we're not going to say transfer and do something else. It's the same $30, by email, with nothing to set up."
      });
    }
    fellow.set("payout_method", method);
    fellow.set("payout_method_set_at", (/* @__PURE__ */ new Date()).toISOString());
    try {
      await e.app.save(fellow);
    } catch (_) {
      return e.json(200, { ok: false, message: "That didn't save. Try once more?" });
    }
    return e.json(200, {
      ok: true,
      method,
      message: method === "card" ? "Done. A prepaid Visa, by email, thirty days after a sale." : "Done. A transfer instead: same $30, it just takes a couple of days longer to land."
    });
  });
  r.routerAdd("GET", "/fellows/payouts", async (e) => {
    const { fellow, deny } = await requireFellow(e);
    if (deny) return deny;
    const band = bandOf(fellow);
    const adult = band === "18_plus";
    const method = (fellow.getString("payout_method") || "").trim() || "card";
    const cashConfigured = !!(e.os.getenv("TREMENDOUS_PRODUCT_CASH_LIKE") || "").trim();
    let blocked = "";
    if (!fellow.getString("email_confirmed_at")) blocked = "email";
    else if (!adult && fellow.getString("parental_consent") !== "confirmed") blocked = "guardian";
    const rows = [];
    let paid = 0, coming = 0;
    try {
      const cs = await e.app.findRecordsByFilter(
        "fellow_conversions",
        "fellow = {:f}",
        "-created",
        100,
        0,
        { f: fellow.get("id") }
      );
      for (const c of cs) {
        const st = c.getString("status");
        if (st === "void") continue;
        const amount = Number(c.get("commission_usd")) || 0;
        const shown = st === "paid" ? "sent" : st === "held" ? "checking" : "coming";
        if (shown === "sent") paid += amount;
        else coming += amount;
        rows.push({
          amount_usd: amount,
          state: shown,
          created: c.getString("created"),
          // The date they were promised, and the date it actually went.
          arrives: (c.getString("pay_after") || "").slice(0, 10),
          sent_on: (c.getString("paid_at") || "").slice(0, 10),
          sent_to: adult ? "you" : "your guardian"
        });
      }
    } catch (_) {
    }
    return e.json(200, {
      ok: true,
      method,
      // Availability, not preference: a client must not render a control the
      // server will refuse, and the server refuses a transfer it cannot send.
      can_choose_cash_like: adult && cashConfigured,
      blocked_on: blocked,
      // Said plainly so they do not bin the email. This is the ONLY place the
      // sender's name belongs on a fellow-facing surface, and it is honest
      // rather than leaky: they are about to receive an email from it.
      note: "The card comes by email from Tremendous, who send the cards. It isn't spam.",
      totals: { sent_usd: paid, coming_usd: coming },
      payouts: rows
    });
  });
}
__name(register6, "register");

// src/routes/submissions.js
init_pb();

// src/lib/parse-url.js
var parseSubmittedUrl = /* @__PURE__ */ __name((input, ageBand) => {
  const UNDER_16 = ageBand === "13_15";
  const PLATFORMS = UNDER_16 ? "TikTok, Instagram, YouTube and X" : "TikTok, Instagram, YouTube, X and LinkedIn";
  const parse1 = /* @__PURE__ */ __name((input2) => {
    const no = /* @__PURE__ */ __name((code, message, platform) => ({ ok: false, code, message, platform: platform || "" }), "no");
    const num = /* @__PURE__ */ __name((s) => {
      const t = String(s).replace(/^0+/, "");
      return t === "" ? "0" : t;
    }, "num");
    let u = String(input2 == null ? "" : input2).trim();
    if (!u) {
      return no("junk", "Paste the link to what you made. We track " + PLATFORMS + ".");
    }
    if (u.length > 2048) {
      return no("junk", "That's far too long to be a link. Paste just the address of the post.");
    }
    u = u.replace(/[\u200B-\u200D\u2060\uFEFF\u202A-\u202E\u2066-\u2069]/g, "");
    const scheme = u.match(/^([A-Za-z][A-Za-z0-9+.\-]*):/);
    if (scheme && !/^https?$/i.test(scheme[1])) {
      return no("junk", "That isn't a web link. Paste the address of the post, starting with https.");
    }
    if (!/^https?:\/\//i.test(u)) u = "https://" + u;
    u = u.replace(/^https?:\/\//i, "https://");
    const split = u.match(/^https:\/\/([^\/?#]+)(.*)$/);
    if (!split || !split[1]) {
      return no("junk", "That doesn't look like a link. Paste the whole thing, starting with https. We track " + PLATFORMS + ".");
    }
    let host = split[1].toLowerCase();
    let rest = split[2] || "";
    if (!/^[a-z0-9.\-]+$/.test(host)) {
      return no("junk", "There's something odd in that address. Copy it again from the post itself.");
    }
    if (host.indexOf(".") < 0) {
      return no("junk", "That doesn't look like a link. Paste the whole thing, starting with https. We track " + PLATFORMS + ".");
    }
    rest = rest.split("#")[0];
    host = host.replace(/^(?:www|m|mobile)\./, "");
    if (host === "instagr.am") host = "instagram.com";
    if (host === "twitter.com") host = "x.com";
    const url = "https://" + host + rest;
    if (UNDER_16 && (host === "linkedin.com" || host === "lnkd.in")) {
      return no("age", "LinkedIn's own rules start at 16, so we'll skip that one for now.", "linkedin");
    }
    const TIKTOK_POST = /^https:\/\/tiktok\.com\/@([A-Za-z0-9._]{1,24})\/(video|photo)\/(\d{6,25})(?:[\/?]|$)/;
    const TIKTOK_V = /^https:\/\/tiktok\.com\/v\/(\d{6,25})(?:\.html)?(?:[\/?]|$)/;
    const TIKTOK_SHORT = /^https:\/\/(?:vm|vt)\.tiktok\.com\/[A-Za-z0-9]{4,24}/;
    const TIKTOK_T = /^https:\/\/tiktok\.com\/t\/[A-Za-z0-9]{4,24}/;
    const INSTAGRAM = /^https:\/\/instagram\.com\/(?:([A-Za-z0-9._]{1,30})\/)?(p|reel|reels|tv)\/([A-Za-z0-9_-]{5,24})(?:[\/?]|$)/;
    const YT_BE = /^https:\/\/youtu\.be\/([A-Za-z0-9_-]{11})(?:[\/?]|$)/;
    const YT_PATH = /^https:\/\/youtube\.com\/(shorts|embed|live|v)\/([A-Za-z0-9_-]{11})(?:[\/?]|$)/;
    const YT_WATCH = /^https:\/\/youtube\.com\/watch\?(?:[^#]*&)?v=([A-Za-z0-9_-]{11})(?:&|$)/;
    const X_STATUS = /^https:\/\/x\.com\/([A-Za-z0-9_]{1,15})\/status(?:es)?\/(\d{1,25})(?:[\/?]|$)/;
    const X_SHORT = /^https:\/\/t\.co\/[A-Za-z0-9]{4,24}/;
    const LI_POSTS = /^https:\/\/linkedin\.com\/posts\/[^\/?#]*?activity-(\d{10,25})/;
    const LI_UPDATE = /^https:\/\/linkedin\.com\/feed\/update\/urn:li:(?:activity|share|ugcPost):(\d{10,25})/;
    const LI_PULSE = /^https:\/\/linkedin\.com\/pulse\/([A-Za-z0-9\-]{3,80})(?:[\/?]|$)/;
    const LI_PULSE_LONG = /^https:\/\/linkedin\.com\/pulse\/[A-Za-z0-9\-]{81,}/;
    const LI_SHORT = /^https:\/\/lnkd\.in\/[A-Za-z0-9_\-]{3,24}/;
    if (TIKTOK_SHORT.test(url) || TIKTOK_T.test(url)) {
      return no("short", "That's TikTok's short link. It doesn't say which video it is. Open it, then use Copy link from the video page; the one you want has your @name in it.", "tiktok");
    }
    if (X_SHORT.test(url)) {
      return no("short", "That's a t.co link, which doesn't say which post it is. Open it and copy the address from the top of the page.", "x");
    }
    if (LI_SHORT.test(url)) {
      return no("short", "That's an lnkd.in short link, which doesn't say which post it is. Open it and copy the address from the top of the page.", "linkedin");
    }
    let m;
    if (m = url.match(TIKTOK_POST)) {
      const handle = m[1], id = num(m[3]);
      return {
        ok: true,
        platform: "tiktok",
        kind: m[2] === "photo" ? "photo" : "video",
        native_id: id,
        url_key: "tiktok:" + id,
        author_claimed: handle,
        url: "https://www.tiktok.com/@" + handle + "/video/" + id,
        probe_url: "https://www.tiktok.com/@" + handle + "/video/" + id
      };
    }
    if (m = url.match(TIKTOK_V)) {
      const id = num(m[1]);
      return {
        ok: true,
        platform: "tiktok",
        kind: "video",
        native_id: id,
        url_key: "tiktok:" + id,
        author_claimed: "",
        url: "https://www.tiktok.com/v/" + id + ".html",
        probe_url: "https://www.tiktok.com/@i/video/" + id
      };
    }
    if (m = url.match(INSTAGRAM)) {
      const user = m[1] || "", surface = m[2], code = m[3];
      const isReel = surface === "reel" || surface === "reels";
      return {
        ok: true,
        platform: "instagram",
        kind: isReel ? "reel" : surface === "tv" ? "video" : "post",
        native_id: code,
        url_key: "instagram:" + code,
        author_claimed: user,
        url: "https://www.instagram.com/" + (isReel ? "reel" : "p") + "/" + code + "/",
        probe_url: ""
      };
    }
    if (m = url.match(YT_BE)) {
      const id = m[1];
      return {
        ok: true,
        platform: "youtube",
        kind: "video",
        native_id: id,
        url_key: "youtube:" + id,
        author_claimed: "",
        url: "https://www.youtube.com/watch?v=" + id,
        probe_url: "https://www.youtube.com/watch?v=" + id
      };
    }
    if (m = url.match(YT_PATH)) {
      const surface = m[1], id = m[2];
      const canon = surface === "shorts" ? "https://www.youtube.com/shorts/" + id : "https://www.youtube.com/watch?v=" + id;
      return {
        ok: true,
        platform: "youtube",
        kind: surface === "shorts" ? "short" : "video",
        native_id: id,
        url_key: "youtube:" + id,
        author_claimed: "",
        url: canon,
        probe_url: canon
      };
    }
    if (m = url.match(YT_WATCH)) {
      const id = m[1];
      return {
        ok: true,
        platform: "youtube",
        kind: "video",
        native_id: id,
        url_key: "youtube:" + id,
        author_claimed: "",
        url: "https://www.youtube.com/watch?v=" + id,
        probe_url: "https://www.youtube.com/watch?v=" + id
      };
    }
    if (m = url.match(X_STATUS)) {
      const handle = m[1], id = num(m[2]);
      return {
        ok: true,
        platform: "x",
        kind: "post",
        native_id: id,
        url_key: "x:" + id,
        author_claimed: handle,
        url: "https://x.com/" + handle + "/status/" + id,
        probe_url: "https://x.com/" + handle + "/status/" + id
      };
    }
    if ((m = url.match(LI_POSTS)) || (m = url.match(LI_UPDATE))) {
      const id = num(m[1]);
      return {
        ok: true,
        platform: "linkedin",
        kind: "post",
        native_id: id,
        url_key: "linkedin:" + id,
        author_claimed: "",
        url: "https://www.linkedin.com/feed/update/urn:li:activity:" + id + "/",
        probe_url: ""
      };
    }
    if (m = url.match(LI_PULSE)) {
      const slug = m[1];
      return {
        ok: true,
        platform: "linkedin",
        kind: "article",
        native_id: slug,
        url_key: "linkedin:pulse:" + slug,
        author_claimed: "",
        url: "https://www.linkedin.com/pulse/" + slug,
        probe_url: ""
      };
    }
    if (LI_PULSE_LONG.test(url)) {
      return no(
        "too_long",
        "That article's address is longer than we can store. Paste the post you shared it in, or send it to hello@anticipy.ai and a person will add it by hand.",
        "linkedin"
      );
    }
    const KNOWN = {
      "tiktok.com": "TikTok",
      "instagram.com": "Instagram",
      "youtube.com": "YouTube",
      "youtu.be": "YouTube",
      "x.com": "X",
      "linkedin.com": "LinkedIn"
    };
    if (KNOWN[host]) {
      return no(
        "not_a_post",
        "That's a " + KNOWN[host] + " link, but it points at a profile or a page rather than at one post. Open the post itself and copy the address from there.",
        host === "youtu.be" ? "youtube" : host.replace(/\.com$/, "")
      );
    }
    return no("unknown", "We only track " + PLATFORMS + " right now. If you made it somewhere else, tell us at hello@anticipy.ai. We'd genuinely like to know where you're posting.");
  }, "parse1");
  const first = parse1(input);
  if (!first.ok) return first;
  const again = parse1(first.url);
  if (!again.ok || again.platform !== first.platform || again.url_key !== first.url_key || again.url !== first.url) {
    return {
      ok: false,
      code: "junk",
      platform: first.platform,
      message: "We couldn't pin that down to a single post. Open it and copy the address from the top of the page."
    };
  }
  return first;
}, "parseSubmittedUrl");

// src/routes/submissions.js
var CTRL = new RegExp("[\\u0000-\\u001F\\u007F]", "g");
var scrub = /* @__PURE__ */ __name((s, n) => String(s == null ? "" : s).replace(CTRL, " ").replace(/\s+/g, " ").trim().slice(0, n), "scrub");
var pbTime = /* @__PURE__ */ __name((v) => {
  if (!v) return NaN;
  let t = String(v).trim().replace(" ", "T");
  if (!/([Zz]|[+-]\d{2}:?\d{2})$/.test(t)) t += "Z";
  return new Date(t).getTime();
}, "pbTime");
var HANDLE_FIELD = { tiktok: "tiktok", youtube: "youtube", x: "x_handle" };
var HANDLE_NAME = { tiktok: "TikTok", youtube: "YouTube", x: "X" };
function register7(r) {
  r.routerAdd("POST", "/fellows/submissions", async (e) => {
    const nowISO = (/* @__PURE__ */ new Date()).toISOString();
    const { fellow, deny } = await requireFellow(e);
    if (deny) return deny;
    let body = {};
    try {
      body = e.requestInfo().body || {};
    } catch (_) {
    }
    const pasted = String(body.url == null ? "" : body.url);
    const note = scrub(body.note, 500);
    const band = fellow.getString("age_band");
    const p = parseSubmittedUrl(pasted, band);
    if (!p.ok) {
      if (p.code === "junk") return e.json(400, { ok: false, field: "url", message: p.message });
      return e.json(200, { ok: false, field: "url", message: p.message });
    }
    if (p.platform === "linkedin" && band === "13_15") {
      return e.json(200, {
        ok: false,
        field: "url",
        message: "LinkedIn's own rules start at 16, so we'll skip that one for now."
      });
    }
    if (p.url_key.length > 120 || p.native_id.length > 80 || p.url.length > 500) {
      return e.json(200, {
        ok: false,
        field: "url",
        message: "That address is longer than we can store. Send it to hello@anticipy.ai and a person will add it by hand."
      });
    }
    if (HANDLE_FIELD[p.platform]) {
      const claimed = String(fellow.getString(HANDLE_FIELD[p.platform]) || "").trim();
      if (!claimed) {
        return e.json(200, {
          ok: false,
          field: "handle",
          need_handle: p.platform,
          message: "What's your " + HANDLE_NAME[p.platform] + " @? We'll put your posts next to it."
        });
      }
    }
    let mine = [];
    try {
      mine = await e.app.findRecordsByFilter(
        "fellow_submissions",
        "fellow = {:f}",
        "-created",
        500,
        0,
        { f: fellow.get("id") }
      );
    } catch (_) {
      mine = [];
    }
    if (mine.length >= 500) {
      return e.json(200, {
        ok: false,
        message: "That's five hundred logged, which is as many as we keep in one list. Write to hello@anticipy.ai and a person will sort it."
      });
    }
    const DAY_MAX = parseInt(e.os.getenv("ANTICIPY_FELLOW_SUBMIT_MAX") || "20", 10);
    let inDay = 0;
    for (const row of mine) {
      const t = pbTime(row.getString("created"));
      if (!isNaN(t) && Date.now() - t < 864e5) inDay++;
    }
    if (inDay >= DAY_MAX) {
      return e.json(200, { ok: false, message: "That's a lot in one day. Try again tomorrow." });
    }
    const ATTEMPT_MAX = parseInt(e.os.getenv("ANTICIPY_FELLOW_SUBMIT_ATTEMPT_MAX") || "60", 10);
    const dayNow = nowISO.slice(0, 10);
    const attemptName = "sub:" + String(fellow.get("id"));
    let attemptMeter = null;
    try {
      attemptMeter = await e.app.findFirstRecordByFilter("fellow_meter", "name = {:n}", { n: attemptName });
    } catch (_) {
      attemptMeter = null;
    }
    if (!attemptMeter) {
      try {
        attemptMeter = new Record(e.app.findCollectionByNameOrId("fellow_meter"));
        attemptMeter.set("name", attemptName);
        attemptMeter.set("hour", dayNow);
        attemptMeter.set("calls", 0);
      } catch (_) {
        attemptMeter = null;
      }
    }
    if (attemptMeter) {
      const usedToday = attemptMeter.getString("hour") === dayNow ? Number(attemptMeter.get("calls")) || 0 : 0;
      if (usedToday >= ATTEMPT_MAX) {
        return e.json(200, { ok: false, message: "That's a lot in one day. Try again tomorrow." });
      }
      try {
        attemptMeter.set("hour", dayNow);
        attemptMeter.set("calls", usedToday + 1);
        await e.app.save(attemptMeter);
      } catch (_) {
      }
    }
    let barred = null;
    try {
      barred = await e.app.findFirstRecordByFilter(
        "fellow_submissions",
        "fellow = {:f} && removed_by = 'hq' && flags ~ {:k}",
        { f: fellow.get("id"), k: "key released by HQ: " + p.url_key + ";" }
      );
    } catch (_) {
      barred = null;
    }
    if (barred) {
      return e.json(200, {
        ok: false,
        message: "We can't add that one. If it's yours, write to hello@anticipy.ai and a person will sort it."
      });
    }
    const rec = new Record(e.app.findCollectionByNameOrId("fellow_submissions"));
    rec.set("fellow", fellow.get("id"));
    rec.set("platform", p.platform);
    rec.set("kind", p.kind);
    rec.set("url", p.url);
    rec.set("url_key", p.url_key);
    rec.set("submitted_url", scrub(pasted, 500));
    rec.set("native_id", p.native_id);
    rec.set("author_claimed", scrub(p.author_claimed, 120));
    rec.set("author_handle", "");
    rec.set("title", "");
    rec.set("thumbnail_url", "");
    rec.set("verify_state", "unverified");
    rec.set("oembed_status", 0);
    rec.set("status", "logged");
    rec.set("removed_by", "");
    rec.set("note", note);
    rec.set("flags", "");
    let saved = false;
    try {
      await e.app.save(rec);
      saved = true;
    } catch (_) {
      saved = false;
    }
    if (!saved) {
      let other = null;
      try {
        other = await e.app.findFirstRecordByFilter("fellow_submissions", "url_key = {:k}", { k: p.url_key });
      } catch (_) {
      }
      if (other && other.getString("fellow") === String(fellow.get("id"))) {
        const M = [
          "January",
          "February",
          "March",
          "April",
          "May",
          "June",
          "July",
          "August",
          "September",
          "October",
          "November",
          "December"
        ];
        let when = "";
        const t = pbTime(other.getString("created"));
        if (!isNaN(t)) {
          const d = new Date(t);
          when = d.getUTCDate() + " " + M[d.getUTCMonth()];
        }
        return e.json(200, {
          ok: true,
          already: true,
          id: other.get("id"),
          message: when ? "You've already logged this one. You added it on " + when + "." : "You've already logged this one."
        });
      }
      if (other) {
        await writeActivity(e.app, {
          actor: "",
          actor_name: "Fellowships",
          action: "fellow.submission_collision",
          subject: "Two fellows claim " + p.url_key + ", held by " + other.getString("fellow") + ", also submitted by " + fellow.get("id"),
          ref: other.get("id")
        });
        return e.json(200, {
          ok: false,
          message: "We can't add that one. If it's yours, write to hello@anticipy.ai and a person will sort it."
        });
      }
      return e.json(200, { ok: false, message: "That didn't save. Try once more?" });
    }
    const OEMBED = {
      tiktok: "https://www.tiktok.com/oembed?url=",
      youtube: "https://www.youtube.com/oembed?format=json&url=",
      x: "https://publish.x.com/oembed?url="
    };
    let mayCall = false;
    if (OEMBED[p.platform] && p.probe_url) {
      const ceiling = parseInt(e.os.getenv("ANTICIPY_FELLOW_OEMBED_CEILING") || "300", 10);
      const hourNow = nowISO.slice(0, 13);
      try {
        const meter = await e.app.findFirstRecordByFilter("fellow_meter", "name = 'oembed'");
        const used = meter.getString("hour") === hourNow ? Number(meter.get("calls")) || 0 : 0;
        if (used < ceiling) {
          meter.set("hour", hourNow);
          meter.set("calls", used + 1);
          await e.app.save(meter);
          mayCall = true;
        }
      } catch (_) {
      }
    }
    let vstate = "unverified", vstatus = 0, author = "", title = "", thumb = "";
    if (mayCall) {
      let res = null;
      try {
        res = await httpSend({
          url: OEMBED[p.platform] + encodeURIComponent(p.probe_url),
          method: "GET",
          timeout: 8
        });
      } catch (_) {
        res = null;
      }
      if (res) {
        vstatus = Number(res.statusCode) || 0;
        if (vstatus >= 200 && vstatus < 300) {
          let j = null;
          try {
            j = res.json;
          } catch (_) {
            j = null;
          }
          if (j) {
            try {
              if (p.platform === "tiktok") {
                const mm = String(j.author_url || "").match(/tiktok\.com\/@([A-Za-z0-9._]{1,24})/);
                author = mm ? mm[1] : "";
                title = String(j.title || "");
                thumb = String(j.thumbnail_url || "");
              } else if (p.platform === "youtube") {
                const mm = String(j.author_url || "").match(/youtube\.com\/@([A-Za-z0-9._\-]{1,120})/);
                author = mm ? mm[1] : String(j.author_name || "");
                title = String(j.title || "");
                thumb = "https://i.ytimg.com/vi/" + p.native_id + "/hqdefault.jpg";
              } else if (p.platform === "x") {
                author = String(j.author_name || "");
                if (!author) {
                  const mm = String(j.author_url || "").match(/x\.com\/([A-Za-z0-9_]{1,15})/);
                  author = mm ? mm[1] : "";
                }
                const pm = String(j.html || "").match(/<p[^>]*>([\s\S]*?)<\/p>/);
                if (pm) title = pm[1].replace(/<[^>]*>/g, " ");
              }
            } catch (_) {
            }
          }
          const claimed = String(fellow.getString(HANDLE_FIELD[p.platform] || "") || "").trim().replace(/^@/, "").toLowerCase();
          const got = String(author || "").trim().replace(/^@/, "").toLowerCase();
          vstate = claimed && got ? claimed === got ? "verified" : "mismatch" : "unverified";
        } else if (vstatus === 400 || vstatus === 404) {
          vstate = "gone";
        }
      }
    }
    let fresh = null;
    try {
      fresh = await e.app.findRecordById("fellow_submissions", rec.get("id"));
    } catch (_) {
      fresh = null;
    }
    const stillOurs = !!fresh && fresh.getString("status") === "logged" && fresh.getString("url_key") === p.url_key;
    if (stillOurs) {
      try {
        fresh.set("verify_state", vstate);
        fresh.set("oembed_status", vstatus);
        fresh.set("verified_at", mayCall ? nowISO : "");
        if (author) fresh.set("author_handle", scrub(author, 120));
        if (title) fresh.set("title", scrub(title, 500));
        if (thumb) fresh.set("thumbnail_url", scrub(thumb, 500));
        if (vstate === "mismatch") {
          fresh.set("status", "flagged");
          const had = fresh.getString("flags");
          fresh.set("flags", (had ? had + " | " : "") + "author mismatch: the platform says " + scrub(author, 60) + ", their profile says " + scrub(fellow.getString(HANDLE_FIELD[p.platform] || ""), 60));
        }
        await e.app.save(fresh);
      } catch (_) {
      }
    }
    if (!stillOurs) {
      return e.json(200, {
        ok: true,
        already: true,
        id: rec.get("id"),
        message: "That one came off your list while we were saving it."
      });
    }
    return e.json(200, {
      ok: true,
      submission: {
        id: fresh.get("id"),
        platform: fresh.getString("platform"),
        kind: fresh.getString("kind"),
        url: fresh.getString("url"),
        title: fresh.getString("title"),
        thumbnail_url: fresh.getString("thumbnail_url"),
        note: fresh.getString("note"),
        // ONLY "gone" ever reaches a fellow. "unverified" is permanent for
        // Instagram and LinkedIn and would read as a mark against them for
        // using those platforms; "mismatch" would tell someone which check
        // caught them, which is how you teach an attacker to pass it next time.
        verify_state: fresh.getString("verify_state") === "gone" ? "gone" : "",
        created: fresh.getString("created")
      }
    });
  });
  r.routerAdd("POST", "/fellows/submissions/remove", async (e) => {
    const { fellow, deny } = await requireFellow(e);
    if (deny) return deny;
    let body = {};
    try {
      body = e.requestInfo().body || {};
    } catch (_) {
    }
    const id = String(body.id || "").trim().slice(0, 40);
    if (!id) return e.json(404, { ok: false, message: "We couldn't find that one." });
    let row = null;
    try {
      row = await e.app.findRecordById("fellow_submissions", id);
    } catch (_) {
    }
    if (!row || row.getString("fellow") !== String(fellow.get("id"))) {
      return e.json(404, { ok: false, message: "We couldn't find that one." });
    }
    if (row.getString("removed_by") === "hq") {
      return e.json(404, { ok: false, message: "We couldn't find that one." });
    }
    row.set("status", "removed");
    row.set("removed_by", "fellow");
    row.set("url_key", "");
    try {
      await e.app.save(row);
    } catch (_) {
      return e.json(200, { ok: false, message: "That didn't save. Try once more?" });
    }
    return e.json(200, { ok: true });
  });
}
__name(register7, "register");

// src/lib/pay-engine.js
init_pb();
function makeEngine(app, os) {
  const VENDOR_SET = (os.getenv("ANTICIPY_PAYOUT_VENDOR") || "").trim().toLowerCase();
  const VENDOR = VENDOR_SET || "tremendous";
  const AMOUNT_MAX = parseFloat(os.getenv("ANTICIPY_FELLOW_PAYOUT_MAX_USD") || "30") || 30;
  const TAX_FORM_USD = parseFloat(os.getenv("ANTICIPY_FELLOW_TAX_FORM_USD") || "600") || 600;
  const MAX_ATTEMPTS = 3;
  const STALE_MS = 15 * 60 * 1e3;
  const nowISO = /* @__PURE__ */ __name(() => (/* @__PURE__ */ new Date()).toISOString(), "nowISO");
  const pbTime2 = /* @__PURE__ */ __name((v) => {
    if (!v) return NaN;
    let t = String(v).trim().replace(" ", "T");
    if (!/([Zz]|[+-]\d{2}:?\d{2})$/.test(t)) t += "Z";
    return new Date(t).getTime();
  }, "pbTime");
  const logAct = /* @__PURE__ */ __name(async (action, subject, ref) => {
    try {
      const a = new Record(app.findCollectionByNameOrId("internal_activity"));
      a.set("actor", "");
      a.set("actor_name", "Fellowships");
      a.set("action", action);
      a.set("subject", String(subject).slice(0, 400));
      if (ref) a.set("ref", ref);
      await app.save(a);
    } catch (_) {
    }
  }, "logAct");
  const sayOnce = /* @__PURE__ */ __name(async (meterName, action, subject) => {
    const day = nowISO().slice(0, 10);
    let m = null;
    try {
      m = await app.findFirstRecordByFilter("fellow_meter", "name = {:n}", { n: meterName });
    } catch (_) {
    }
    if (!m) {
      try {
        m = new Record(app.findCollectionByNameOrId("fellow_meter"));
        m.set("name", meterName);
        m.set("hour", "");
        m.set("calls", 0);
        await app.save(m);
      } catch (_) {
        return false;
      }
    }
    if (m.getString("hour") === day) return false;
    m.set("hour", day);
    m.set("calls", (Number(m.get("calls")) || 0) + 1);
    try {
      await app.save(m);
    } catch (_) {
    }
    await logAct(action, subject, "");
    return true;
  }, "sayOnce");
  const vendor = /* @__PURE__ */ __name(async (op, args) => {
    const a = args || {};
    const key = os.getenv("TREMENDOUS_API_KEY") || "";
    const prod = String(os.getenv("TREMENDOUS_ENV") || "").trim().toLowerCase() === "production";
    const base = prod ? "https://api.tremendous.com/api/v2" : "https://testflight.tremendous.com/api/v2";
    const H = {
      "Authorization": "Bearer " + key,
      "Content-Type": "application/json",
      "Accept": "application/json",
      // Ignored today — external_id in the body is Tremendous's whole
      // idempotency mechanism — but free, and already right on the day a vendor
      // honours a header instead.
      "Idempotency-Key": String(a.key || "")
    };
    const scrub2 = /* @__PURE__ */ __name((v) => {
      let t = "";
      try {
        t = String(v == null ? "" : v);
      } catch (_) {
        t = "";
      }
      t = t.slice(0, 2e3);
      if (key) t = t.split(key).join("[key]");
      return t.replace(/(?:Bearer\s+)?[A-Za-z0-9_\-]{24,}/g, "[redacted]");
    }, "scrub");
    const msgOf = /* @__PURE__ */ __name((res2) => {
      let m = "";
      try {
        m = String(res2.json.errors.message || "");
      } catch (_) {
      }
      if (!m) {
        try {
          m = String(res2.json.error.message || "");
        } catch (_) {
        }
      }
      if (!m) {
        try {
          m = String(res2.json.message || "");
        } catch (_) {
        }
      }
      return scrub2(m);
    }, "msgOf");
    if (op === "config") {
      if (!key) return { configured: false, ok: false, reason: "not_configured", env: prod ? "production" : "sandbox", error: "" };
      if (prod && key.indexOf("TEST_") === 0) {
        return {
          configured: true,
          ok: false,
          reason: "misconfigured",
          env: "production",
          error: "TREMENDOUS_ENV is production but the key is a sandbox key"
        };
      }
      if (!prod && key.indexOf("PROD_") === 0) {
        return {
          configured: true,
          ok: false,
          reason: "misconfigured",
          env: "sandbox",
          error: "the key is a production key but TREMENDOUS_ENV is not production"
        };
      }
      return { configured: true, ok: true, reason: "", env: prod ? "production" : "sandbox", error: "" };
    }
    if (op === "balance") {
      if (!key) return { configured: false, ok: false, cents: -1, http: 0, error: "" };
      try {
        const res2 = await httpSend({ url: base + "/funding_sources", method: "GET", headers: H, timeout: 15 });
        if (res2.statusCode !== 200) {
          return { configured: true, ok: false, cents: -1, http: res2.statusCode, error: msgOf(res2) };
        }
        let cents = -1;
        try {
          const list = res2.json.funding_sources || [];
          for (const f of list) {
            if (String(f.method) !== "balance") continue;
            if (String(f.status) !== "active") continue;
            let apiOK = false;
            try {
              for (const p of f.usage_permissions || []) if (String(p) === "api_orders") apiOK = true;
            } catch (_) {
            }
            if (!apiOK) continue;
            const c = Number(f.meta.available_cents);
            if (!isNaN(c)) cents = c;
          }
        } catch (_) {
          cents = -1;
        }
        return { configured: true, ok: cents >= 0, cents, http: 200, error: "" };
      } catch (err) {
        return { configured: true, ok: false, cents: -1, http: 0, error: scrub2(err) };
      }
    }
    if (!key) return { outcome: "not_configured", http: 0, error: "", orderId: "", rewardId: "", product: "" };
    const STORED = os.getenv("TREMENDOUS_PRODUCT_STORED_VALUE") || "Q24BD9EZ332JT";
    const CASH = os.getenv("TREMENDOUS_PRODUCT_CASH_LIKE") || "";
    const product = a.adult === true && a.method === "cash_like" && CASH ? CASH : STORED;
    const reward = {
      value: { denomination: a.amountUsd, currency_code: "USD" },
      products: [product],
      recipient: { name: String(a.name || "").slice(0, 120), email: String(a.email || "") },
      // EMAIL, never LINK: an unsent link holds real value we would forfeit, and
      // a link is a bearer token to cash that must never touch a log line.
      delivery: {
        method: "EMAIL",
        meta: {
          sender_name: "Anticipy Fellowships",
          subject_line: "Your $" + a.amountUsd + " from the Anticipy fellowship",
          message: String(a.note || "").slice(0, 400)
        }
      }
    };
    const campaign = os.getenv("TREMENDOUS_CAMPAIGN_ID") || "";
    if (campaign) reward.campaign_id = campaign;
    const payload = {
      external_id: a.key,
      // the idempotency key. Persisted before this call.
      payment: { funding_source_id: os.getenv("TREMENDOUS_FUNDING_SOURCE_ID") || "BALANCE" },
      reward
    };
    const idOf = /* @__PURE__ */ __name((res2) => {
      const out = { orderId: "", rewardId: "", total: NaN, status: "" };
      try {
        out.orderId = String(res2.json.order.id || "");
      } catch (_) {
      }
      try {
        out.rewardId = String(res2.json.order.rewards[0].id || "");
      } catch (_) {
      }
      try {
        out.total = Number(res2.json.order.payment.total);
      } catch (_) {
      }
      try {
        out.status = String(res2.json.order.status || "");
      } catch (_) {
      }
      return out;
    }, "idOf");
    const reconcile = /* @__PURE__ */ __name(async () => {
      try {
        const r2 = await httpSend({
          url: base + "/orders?external_id=" + encodeURIComponent(String(a.key)),
          method: "GET",
          headers: H,
          timeout: 15
        });
        if (r2.statusCode === 200) {
          let list = null;
          try {
            list = r2.json.orders;
          } catch (_) {
            list = null;
          }
          if (list) {
            let n = 0, first = null;
            try {
              for (const o of list) {
                n++;
                if (n === 1) first = o;
              }
            } catch (_) {
              n = -1;
              first = null;
            }
            if (n > 0 && first) {
              let oid = "", rid = "";
              try {
                oid = String(first.id || "");
              } catch (_) {
              }
              try {
                rid = String(first.rewards[0].id || "");
              } catch (_) {
              }
              if (oid) {
                return {
                  outcome: "duplicate",
                  http: 200,
                  orderId: oid,
                  rewardId: rid,
                  product,
                  error: "reconciled after an unclear response: the order exists"
                };
              }
              return null;
            }
            if (n === 0) {
              return {
                outcome: "no_send",
                http: 200,
                orderId: "",
                rewardId: "",
                product,
                error: "reconciled after an unclear response: no order exists under this key"
              };
            }
          }
        }
      } catch (_) {
      }
      return null;
    }, "reconcile");
    let res = null;
    try {
      res = await httpSend({
        url: base + "/orders",
        method: "POST",
        headers: H,
        body: JSON.stringify(payload),
        timeout: 25
      });
    } catch (err) {
      const rec2 = await reconcile();
      if (rec2) return rec2;
      return { outcome: "unknown", http: 0, orderId: "", rewardId: "", product, error: scrub2(err) };
    }
    const code = Number(res.statusCode) || 0;
    const got = idOf(res);
    if (code === 200 || code === 201) {
      if (!got.orderId) {
        const rec2 = await reconcile();
        if (rec2) return rec2;
        return {
          outcome: "unknown",
          http: code,
          orderId: "",
          rewardId: "",
          product,
          error: "the vendor returned " + code + " with no order id"
        };
      }
      if (!isNaN(got.total) && Math.abs(got.total - Number(a.amountUsd)) > 5e-3) {
        return {
          outcome: "conflict",
          http: code,
          orderId: got.orderId,
          rewardId: got.rewardId,
          product,
          error: "the vendor charged " + got.total + " for a $" + a.amountUsd + " reward"
        };
      }
      return {
        outcome: code === 200 ? "sent" : "duplicate",
        http: code,
        orderId: got.orderId,
        rewardId: got.rewardId,
        product,
        error: ""
      };
    }
    if (code === 402) return { outcome: "unfunded", http: 402, orderId: "", rewardId: "", product, error: msgOf(res) };
    if (code === 409) return { outcome: "conflict", http: 409, orderId: "", rewardId: "", product, error: msgOf(res) };
    if (code === 429) return { outcome: "rate_limited", http: 429, orderId: "", rewardId: "", product, error: msgOf(res) };
    if (code === 400 || code === 401 || code === 403 || code === 404 || code === 422) {
      return { outcome: "no_send", http: code, orderId: "", rewardId: "", product, error: msgOf(res) };
    }
    const rec = await reconcile();
    if (rec) return rec;
    return { outcome: "unknown", http: code, orderId: "", rewardId: "", product, error: msgOf(res) };
  }, "vendor");
  const payOne = /* @__PURE__ */ __name(async (convId, opts) => {
    const o = opts || {};
    let conv = null;
    try {
      conv = await app.findRecordById("fellow_conversions", String(convId));
    } catch (_) {
    }
    if (!conv) return { ok: false, state: "missing", message: "no such conversion" };
    const hold = /* @__PURE__ */ __name(async (reason) => {
      conv.set("status", "held");
      conv.set("review_reason", String(reason).slice(0, 500));
      try {
        await app.save(conv);
      } catch (_) {
      }
      await logAct("fellow.payout_held", String(reason).slice(0, 300), conv.get("id"));
      return { ok: false, state: "held", message: String(reason) };
    }, "hold");
    const wait = /* @__PURE__ */ __name(async (why, blocked) => {
      conv.set("status", "waiting");
      conv.set("review_reason", why);
      conv.set("payout_blocked_on", String(blocked || ""));
      conv.set("payout_checked_at", nowISO());
      try {
        await app.save(conv);
      } catch (_) {
      }
      return { ok: false, state: "waiting", blocked, message: why };
    }, "wait");
    const releasable = { held: true, needs_review: true };
    if (o.approve === true && releasable[conv.getString("status")] === true) {
      const wasStatus = conv.getString("status");
      conv.set("status", "pending");
      conv.set("review_reason", "");
      conv.set("payout_blocked_on", "");
      conv.set("payout_attempts", 0);
      try {
        await app.save(conv);
      } catch (_) {
        return { ok: false, state: wasStatus, message: "couldn't release that" };
      }
      await logAct(
        wasStatus === "needs_review" ? "fellow.payout_review_released" : "fellow.payout_released",
        "A person released a " + wasStatus + " conversion for payment",
        conv.get("id")
      );
    }
    const status = conv.getString("status");
    if (status === "paid") {
      return { ok: true, state: "paid", already: true, message: "already paid, nothing was sent" };
    }
    if (status === "paying") return { ok: false, state: "paying", message: "an attempt is already in flight" };
    if (status === "void") return { ok: false, state: "void", message: "this conversion will never pay" };
    if (status === "needs_review") {
      return {
        ok: false,
        state: "needs_review",
        message: conv.getString("review_reason") || "a person has to settle this one by hand"
      };
    }
    if (status === "held") {
      return { ok: false, state: "held", message: conv.getString("review_reason") || "held for a person to look at" };
    }
    if (status !== "pending" && status !== "waiting") {
      return await hold("This row's status was " + JSON.stringify(status) + ", which the payout rail does not understand. It was held rather than guessed at.");
    }
    const pa = pbTime2(conv.getString("pay_after"));
    if (o.now !== true) {
      if (isNaN(pa)) {
        return await hold("This conversion has no usable pay-after date, so the 30-day clock cannot be checked. Set one, then release it.");
      }
      if (Date.now() < pa) {
        return { ok: false, state: "pending", message: "not due until " + conv.getString("pay_after") };
      }
    }
    const cfg = await vendor("config", {});
    if (!cfg.configured) {
      return {
        ok: false,
        state: "pending",
        blocked: "not_configured",
        message: "payouts are not switched on yet, so nothing was sent"
      };
    }
    if (!cfg.ok) {
      await sayOnce(
        "payout_cfg",
        "fellow.payout_misconfigured",
        "The payout rail is configured wrongly and nothing can send: " + cfg.error
      );
      return { ok: false, state: "pending", blocked: "misconfigured", message: cfg.error };
    }
    let fellow = null;
    try {
      fellow = await app.findRecordById("fellows", conv.getString("fellow"));
    } catch (_) {
    }
    if (!fellow) {
      return await hold("The fellow row this conversion points at is gone. Nothing can be paid until somebody works out who is owed it.");
    }
    if (fellow.getString("status") === "removed") {
      return await hold("This fellow was removed. Under the never-clawed-back rule they may still be owed this; that is a decision for a person, not a cron.");
    }
    if (conv.getString("code") && conv.getString("code") !== fellow.getString("referral_code")) {
      return await hold("The referral code on this sale is not the fellow's current code, so the credit is ambiguous. Check it before paying.");
    }
    let band = fellow.getString("age_band") || "";
    const bm = Number(fellow.get("birth_month")), by = Number(fellow.get("birth_year"));
    if (bm && by) {
      const d = /* @__PURE__ */ new Date();
      let age = d.getUTCFullYear() - by;
      if (d.getUTCMonth() + 1 < bm) age -= 1;
      band = age >= 18 ? "18_plus" : age >= 16 ? "16_17" : "13_15";
    }
    const adult = band === "18_plus";
    if (!fellow.getString("email_confirmed_at")) {
      return await wait("We're waiting on them to confirm their email address.", "email");
    }
    if (!adult && fellow.getString("parental_consent") !== "confirmed") {
      return await wait("We're waiting on a parent or guardian to finish the payout step.", "guardian");
    }
    const method = async(fellow.getString("payout_method") || "").trim() || "card";
    if (adult && method === "cash_like" && !(os.getenv("TREMENDOUS_PRODUCT_CASH_LIKE") || "").trim()) {
      return await hold("This fellow chose a transfer, but no cash-like product is configured (TREMENDOUS_PRODUCT_CASH_LIKE is unset), so the only thing this rail could send them is a card they did not ask for. Configure it, or set them back to card and tell them. Do not just send the card.");
    }
    if (!adult && method === "cash_like") {
      return await hold("This fellow is under 18 and their payout method is set to a cash-like rail. That cannot be paid: a minor cannot hold a money account. Set them back to card.");
    }
    if (!adult && !VENDOR_SET) {
      return await wait("We're waiting on the vendor's written answer about paying recipients under 18 before any under-18 payment goes out.", "vendor_age");
    }
    if (!fellow.get("code_active")) {
      return await hold("Everything else about this payment is ready but the fellow's code is switched off, which means a person turned it off. Decide before paying.");
    }
    const amount = Number(conv.get("commission_usd")) || 0;
    if (!(amount >= 1 && amount <= AMOUNT_MAX)) {
      return await hold("This conversion is set to $" + amount + ", which is outside the $1-$" + AMOUNT_MAX + " band. A typo must never be able to wire somebody thousands of dollars.");
    }
    const lifetime = Number(fellow.get("lifetime_paid_usd")) || 0;
    if (lifetime + amount > TAX_FORM_USD) {
      return await hold("Paying this would take them past $" + TAX_FORM_USD + " lifetime. Collect the tax form first, then release. Do not hold anything they are already owed longer than that takes.");
    }
    const toGuardian = !adult;
    const rName = String((toGuardian ? fellow.getString("guardian_name") : fellow.getString("name")) || "").trim();
    const rEmail = String((toGuardian ? fellow.getString("guardian_email") : fellow.getString("email")) || "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(rEmail)) {
      return await hold("There is no usable address to send " + (toGuardian ? "the guardian's" : "their") + " card to. Confirm it out of band. A bounce is the one failure the vendor will not tell us about at the time.");
    }
    const fellowFirst = String(fellow.getString("name") || "").trim().split(/\s+/)[0] || String(fellow.getString("email") || "").split("@")[0];
    if (o.probe === true) {
      if (conv.getString("status") !== "pending") {
        conv.set("status", "pending");
        conv.set("review_reason", "");
        conv.set("payout_blocked_on", "");
        conv.set("payout_checked_at", nowISO());
        try {
          await app.save(conv);
        } catch (_) {
          return { ok: false, state: "waiting", message: "couldn't return it to the pay lane" };
        }
        await logAct(
          "fellow.payout_unblocked",
          "A parked payout came unblocked and is back in the pay lane",
          conv.get("id")
        );
      }
      return { ok: true, state: "ready", message: "nothing is blocking this one" };
    }
    let key = conv.getString("payout_key");
    if (!key) {
      key = "fc-" + conv.get("id");
      conv.set("payout_key", key);
      try {
        await app.save(conv);
      } catch (_) {
        return {
          ok: false,
          state: "pending",
          message: "couldn't persist the idempotency key, so nothing was sent"
        };
      }
    }
    let counted = Number(conv.get("payout_attempts")) || 0;
    if (counted >= MAX_ATTEMPTS) {
      return await hold("Three payout attempts have failed. " + (conv.getString("review_reason") || "").slice(0, 300));
    }
    const seq = Math.max(Number(conv.get("payout_seq")) || 0, counted) + 1;
    const idem = key + "#" + seq;
    let prow = null;
    try {
      prow = new Record(app.findCollectionByNameOrId("fellow_payouts"));
      prow.set("conversion", conv.get("id"));
      prow.set("fellow", fellow.get("id"));
      prow.set("idempotency_key", idem);
      prow.set("attempt", counted + 1);
      prow.set("amount_usd", amount);
      prow.set("vendor", VENDOR);
      prow.set("state", "claimed");
      prow.set("age_band_at_payment", band);
      prow.set("delivery", "email");
      await app.save(prow);
    } catch (_) {
      return { ok: false, state: "raced", message: "another worker already claimed this attempt" };
    }
    conv.set("status", "paying");
    conv.set("payout_claimed_at", nowISO());
    conv.set("payout_attempts", counted + 1);
    conv.set("payout_seq", seq);
    conv.set("payout_blocked_on", "");
    try {
      await app.save(conv);
    } catch (_) {
      try {
        await app.delete(prow);
      } catch (_2) {
        prow.set("idempotency_key", "");
        prow.set("state", "skipped");
        prow.set("error", ("claimed as " + idem + " but the conversion could not be moved; nothing was sent and the key was released").slice(0, 2e3));
        prow.set("finished_at", nowISO());
        try {
          await app.save(prow);
        } catch (_3) {
        }
      }
      return { ok: false, state: "pending", message: "couldn't take the claim; nothing was sent" };
    }
    const out = await vendor("send", {
      key,
      amountUsd: amount,
      name: rName || fellowFirst,
      email: rEmail,
      adult,
      method,
      note: toGuardian ? "This is " + fellowFirst + "'s $" + amount + " from the Anticipy fellowship. Somebody bought through their link. There is nothing to do except spend it." : "Somebody bought through your link. That's your $" + amount + ". Nothing to do except spend it."
    });
    const fin = /* @__PURE__ */ __name(async (state) => {
      prow.set("state", state);
      prow.set("http_status", Number(out.http) || 0);
      if (out.error) prow.set("error", String(out.error).slice(0, 2e3));
      if (out.orderId) prow.set("vendor_order_id", out.orderId);
      if (out.rewardId) prow.set("vendor_reward_id", out.rewardId);
      if (out.product) prow.set("product_id", out.product);
      prow.set("finished_at", nowISO());
      try {
        await app.save(prow);
      } catch (_) {
      }
    }, "fin");
    const settlePaid = /* @__PURE__ */ __name(async (replay) => {
      await fin(replay ? "duplicate" : "sent");
      conv.set("status", "paid");
      conv.set("paid_at", nowISO());
      conv.set("payout_ref", out.orderId);
      conv.set("review_reason", "");
      try {
        await app.save(conv);
      } catch (_) {
      }
      try {
        let total = 0, seen = 0;
        const paidRows = await app.findRecordsByFilter(
          "fellow_conversions",
          "fellow = {:f} && status = 'paid'",
          "-created",
          500,
          0,
          { f: fellow.get("id") }
        );
        for (const pr of paidRows) {
          seen++;
          total += Number(pr.get("commission_usd")) || 0;
        }
        const f2 = await app.findRecordById("fellows", fellow.get("id"));
        const had = Number(f2.get("lifetime_paid_usd")) || 0;
        f2.set("lifetime_paid_usd", seen > 0 ? Math.max(total, had) : had + amount);
        await app.save(f2);
      } catch (_) {
        try {
          fellow.set("lifetime_paid_usd", lifetime + amount);
          await app.save(fellow);
        } catch (_2) {
        }
      }
      await logAct(
        replay ? "fellow.payout_replayed" : "fellow.payout_sent",
        "$" + amount + " to " + (toGuardian ? "a guardian for " : "") + fellowFirst + (replay ? ", the vendor already had this order, so nothing was charged twice" : ""),
        conv.get("id")
      );
      return { ok: true, state: "paid", replay: !!replay, message: replay ? "already existed at the vendor, marked paid, nothing was charged again" : "sent" };
    }, "settlePaid");
    const review = /* @__PURE__ */ __name(async (why) => {
      conv.set("status", "needs_review");
      conv.set("review_reason", (why + " Search the vendor for external_id " + key + " BEFORE doing anything else: if an order exists, mark this paid; if not, release it.").slice(0, 500));
      try {
        await app.save(conv);
      } catch (_) {
      }
      await logAct("fellow.payout_needs_review", why + " (external_id " + key + ")", conv.get("id"));
      return { ok: false, state: "needs_review", message: why };
    }, "review");
    const release = /* @__PURE__ */ __name(async (why, countsAsAttempt) => {
      await fin(countsAsAttempt ? "failed" : "skipped");
      if (!countsAsAttempt) conv.set("payout_attempts", counted);
      if (countsAsAttempt && counted + 1 >= MAX_ATTEMPTS) {
        conv.set("status", "held");
        conv.set("review_reason", ("Three payout attempts failed. Last: " + why).slice(0, 500));
        try {
          await app.save(conv);
        } catch (_) {
        }
        await logAct("fellow.payout_gave_up", "Gave up after " + MAX_ATTEMPTS + " tries: " + why, conv.get("id"));
        return { ok: false, state: "held", message: why };
      }
      conv.set("status", "pending");
      conv.set("payout_claimed_at", "");
      conv.set("review_reason", String(why).slice(0, 500));
      try {
        await app.save(conv);
      } catch (_) {
      }
      return { ok: false, state: "pending", message: why };
    }, "release");
    if (out.outcome === "sent") return await settlePaid(false);
    if (out.outcome === "duplicate") return await settlePaid(true);
    if (out.outcome === "unfunded") {
      await sayOnce(
        "payout_fund",
        "fellow.payout_unfunded",
        "The payout balance is empty and at least one fellow is due. Top it up by ACH, never by card."
      );
      return await release("The payout balance is empty. This is ours to fix and it will go out as soon as it is topped up.", false);
    }
    if (out.outcome === "rate_limited") {
      return await release("The vendor rate-limited us. Trying again on the next sweep.", false);
    }
    if (out.outcome === "no_send") {
      return await release("The vendor refused the order (" + (Number(out.http) || 0) + "): " + (out.error || "no reason given") + ". Nothing was sent.", true);
    }
    if (out.outcome === "conflict") {
      await fin("failed");
      return await review("The vendor already has an order under this key with DIFFERENT details (" + (out.error || "no detail given") + "), which means two code paths disagree about what this person is owed.");
    }
    if (out.outcome === "not_configured") {
      return await release("The payout rail was switched off mid-attempt. Nothing was sent.", false);
    }
    await fin("unknown");
    return await review("A payout attempt returned " + (Number(out.http) || 0) + " and we do not know whether the money moved" + (out.error ? " (" + out.error + ")" : "") + ".");
  }, "payOne");
  const backstop = /* @__PURE__ */ __name(async () => {
    let stuck = [];
    try {
      stuck = await app.findRecordsByFilter(
        "fellow_conversions",
        "status = 'paying' && payout_claimed_at != ''",
        "+payout_claimed_at",
        20,
        0
      );
    } catch (_) {
      stuck = [];
    }
    let n = 0;
    for (const c of stuck) {
      const t = pbTime2(c.getString("payout_claimed_at"));
      if (isNaN(t) || Date.now() - t < STALE_MS) continue;
      c.set("status", "needs_review");
      c.set("review_reason", ("A payout attempt started and never finished. Check the vendor for external_id " + (c.getString("payout_key") || "(none minted)") + " BEFORE doing anything else: if an order exists, mark this paid; if not, release it.").slice(0, 500));
      try {
        await app.save(c);
        n++;
      } catch (_) {
        continue;
      }
      await logAct("fellow.payout_stuck", "A payout attempt died mid-flight and needs a person: external_id " + (c.getString("payout_key") || "(none)"), c.get("id"));
    }
    return n;
  }, "backstop");
  const wakeWaiting = /* @__PURE__ */ __name(async (limit) => {
    let parked = [];
    try {
      parked = await app.findRecordsByFilter(
        "fellow_conversions",
        "status = 'waiting'",
        "+payout_checked_at",
        limit || 25,
        0
      );
    } catch (_) {
      parked = [];
    }
    let woken = 0;
    for (const c of parked) {
      try {
        const r = await payOne(c.get("id"), { probe: true });
        if (r && r.state === "ready") woken++;
      } catch (_) {
      }
    }
    return woken;
  }, "wakeWaiting");
  const dueRows = /* @__PURE__ */ __name(async (limit) => {
    try {
      return await app.findRecordsByFilter(
        "fellow_conversions",
        "status = 'pending' && pay_after != '' && pay_after <= {:now}",
        "+pay_after",
        limit,
        0,
        { now: nowISO() }
      );
    } catch (_) {
      return [];
    }
  }, "dueRows");
  return {
    VENDOR,
    VENDOR_SET,
    vendor,
    payOne,
    backstop,
    wakeWaiting,
    dueRows,
    logAct,
    sayOnce,
    nowISO,
    pbTime: pbTime2
  };
}
__name(makeEngine, "makeEngine");

// src/routes/pay.js
function registerPayoutCron(r) {
  r.cronAdd("fellow_payout_sweep", "23 * * * *", async (ctx) => {
    const E = makeEngine(ctx.app, ctx.os);
    const stuck = await E.backstop();
    if (stuck) console.log("fellow_payout_sweep: " + stuck + " stale claim(s) sent for review");
    const cfg = await E.vendor("config", {});
    if (!cfg.configured) {
      await E.sayOnce(
        "payout_cfg",
        "fellow.payout_not_configured",
        "The payout rail has no key set, so nothing can send. This is not a fault. It is switched off."
      );
      return;
    }
    if (!cfg.ok) {
      await E.sayOnce(
        "payout_cfg",
        "fellow.payout_misconfigured",
        "The payout rail is configured wrongly and nothing can send: " + cfg.error
      );
      return;
    }
    const woken = await E.wakeWaiting(25);
    if (woken) console.log("fellow_payout_sweep: " + woken + " parked payout(s) back in the pay lane");
    const due = await E.dueRows(10);
    if (!due.length) return;
    let needCents = 0;
    for (const c of due) needCents += Math.round((Number(c.get("commission_usd")) || 0) * 100);
    const bal = await E.vendor("balance", {});
    if (bal.configured && bal.cents >= 0 && bal.cents < needCents) {
      await E.sayOnce(
        "payout_fund",
        "fellow.payout_unfunded",
        "The payout balance is $" + (bal.cents / 100).toFixed(2) + " and $" + (needCents / 100).toFixed(2) + " is due. Nothing was attempted. Top up by ACH, never by card. A card costs 3% for nothing."
      );
      return;
    }
    for (const c of due) {
      try {
        const res = await E.payOne(c.get("id"), {});
        if (res.state === "raced") continue;
      } catch (err) {
        console.log("fellow_payout_sweep: unhandled while paying a conversion: " + err);
      }
    }
  });
}
__name(registerPayoutCron, "registerPayoutCron");

// src/index.js
var router = createRouter();
register(router);
register2(router);
register3(router);
register4(router);
register5(router);
register6(router);
register7(router);
registerPayoutCron(router);
var PRETTY = {
  "/": "/fellowships.html",
  "/fellowships": "/fellowships.html",
  "/fellowship-growth-learning": "/fellowship-growth-learning.html"
};
var index_default = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (path.indexOf("/internal") === 0 || path === "/fellows/hq") {
      return json404();
    }
    const app = new App(env.DB);
    const hit = router.match(request.method, path);
    if (hit) {
      const e = new RequestEvent(request, env, app, hit.params);
      e.os = makeOs(env);
      await e._readBody();
      try {
        const res = await hit.handler(e);
        if (res) {
          const out = request.method === "HEAD" ? new Response(null, { status: res.status, headers: res.headers }) : res;
          return withSecurityHeaders(out);
        }
      } catch (err) {
        console.error("route error", path, err && err.message);
        return withSecurityHeaders(new Response(
          JSON.stringify({ ok: false, message: "Something went wrong on our end. Try again in a moment." }),
          { status: 500, headers: { "Content-Type": "application/json" } }
        ));
      }
    }
    if (PRETTY[path]) {
      const res = await env.ASSETS.fetch(new Request(url.origin + PRETTY[path], request));
      return withSecurityHeaders(new Response(res.body, res));
    }
    const asset = await env.ASSETS.fetch(request);
    return withSecurityHeaders(new Response(asset.body, asset));
  },
  // pb_hooks/fellowship_payouts.pb.js: cronAdd("fellow_payout_sweep", "23 * * * *")
  async scheduled(event, env, ctx) {
    const app = new App(env.DB);
    for (const c of router.crons) {
      try {
        await c.handler({ app, os: makeOs(env) });
      } catch (err) {
        console.error("cron " + c.name + " failed:", err && err.message);
      }
    }
  }
};
function json404() {
  return withSecurityHeaders(new Response(JSON.stringify({ error: "not found" }), {
    status: 404,
    headers: { "Content-Type": "application/json" }
  }));
}
__name(json404, "json404");
function withSecurityHeaders(response) {
  const h = response.headers;
  h.set("X-Frame-Options", "DENY");
  h.set("X-Content-Type-Options", "nosniff");
  h.set("Referrer-Policy", "strict-origin-when-cross-origin");
  h.set("Permissions-Policy", "microphone=(), camera=(), geolocation=()");
  h.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
  return response;
}
__name(withSecurityHeaders, "withSecurityHeaders");
export {
  index_default as default
};
//# sourceMappingURL=index.js.map
