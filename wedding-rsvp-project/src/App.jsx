import { useState, useEffect, useCallback, useRef, useMemo } from "react";

// ── Supabase SQL Schema (for reference) ──────────────────────────────────────
// create table guests (
//   id uuid default gen_random_uuid() primary key,
//   full_name text not null, phone text,
//   attending boolean not null default true,
//   guest_count integer not null default 1,
//   created_at timestamp with time zone default now()
// );
// alter table guests enable row level security;
// create policy "Allow all" on guests for all using (true);
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_SETTINGS = {
  COUPLE_NAMES: "נועה & יונתן",
  WEDDING_DATE: "2025-09-14T18:00",
  VENUE_NAME: "אולם השושנה, תל אביב",
  VENUE_ADDRESS: "דרך השרון 12, תל אביב",
  WAZE_LINK: "https://waze.com/ul?ll=32.0853,34.7818&navigate=yes",
  BIT_PHONE: "",
  PAYBOX_PHONE: "",
  ADMIN_PASSWORD: "admin123",
  SUPABASE_URL: "https://ztpqglknrvpbmtjrzcqc.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp0cHFnbGtucnZwYm10anJ6Y3FjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwNzYxMzksImV4cCI6MjA4ODY1MjEzOX0.wtW24UB6eZrYcsZi44YZMbWFWKGBeatfdQTRlnrOAlU",
};

function loadSettings() {
  try {
    const s = localStorage.getItem("wedding_settings");
    const saved = s ? JSON.parse(s) : {};
    // Always use DEFAULT_SETTINGS as base so hardcoded keys are never overridden by empty saved values
    return {
      ...DEFAULT_SETTINGS,
      ...saved,
      SUPABASE_URL: saved.SUPABASE_URL || DEFAULT_SETTINGS.SUPABASE_URL,
      SUPABASE_ANON_KEY: saved.SUPABASE_ANON_KEY || DEFAULT_SETTINGS.SUPABASE_ANON_KEY,
    };
  } catch { return { ...DEFAULT_SETTINGS }; }
}
function saveSettings(s) {
  localStorage.setItem("wedding_settings", JSON.stringify(s));
}

// ── Supabase client ───────────────────────────────────────────────────────────
function createSupabaseClient(url, key) {
  if (!url || !key) return null;
  const headers = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  return {
    async insert(row) {
      // Remove client-generated id/created_at — Supabase generates these
      const { id, created_at, ...cleanRow } = row;
      const r = await fetch(`${url}/rest/v1/guests`, {
        method: "POST",
        headers: { ...headers, Prefer: "return=minimal" },
        body: JSON.stringify(cleanRow),
      });
      if (!r.ok) {
        const errText = await r.text();
        console.error("Supabase insert error:", r.status, errText);
        throw new Error(errText);
      }
      return true;
    },
    async select() {
      const r = await fetch(`${url}/rest/v1/guests?order=created_at.desc`, { headers });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
  };
}

// ── localStorage guest fallback ───────────────────────────────────────────────
function lsGetGuests() {
  try { return JSON.parse(localStorage.getItem("wedding_guests") || "[]"); } catch { return []; }
}
function lsSaveGuest(g) {
  const list = lsGetGuests(); list.unshift(g);
  localStorage.setItem("wedding_guests", JSON.stringify(list));
}

// ── Countdown hook ────────────────────────────────────────────────────────────
function useCountdown(target) {
  const calc = useCallback(() => {
    const diff = new Date(target) - Date.now();
    if (diff <= 0) return { d: 0, h: 0, m: 0, s: 0 };
    return { d: Math.floor(diff / 86400000), h: Math.floor((diff % 86400000) / 3600000), m: Math.floor((diff % 3600000) / 60000), s: Math.floor((diff % 60000) / 1000) };
  }, [target]);
  const [t, setT] = useState(calc);
  useEffect(() => { const id = setInterval(() => setT(calc()), 1000); return () => clearInterval(id); }, [calc]);
  return t;
}

// ── Export CSV ────────────────────────────────────────────────────────────────
function downloadCSV(data, filename) {
  const bom = "﻿";
  const csv = bom + data.map((r) => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(",")).join("\n");
  const a = Object.assign(document.createElement("a"), {
    href: URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" })),
    download: filename,
  });
  document.body.appendChild(a); a.click(); a.remove();
}

function exportAll(guests) {
  const hdr = ["#", "שם מלא", "טלפון", "סטטוס", "מספר אורחים", "תאריך רישום"];
  const sorted = [...guests].sort((a, b) => (b.attending ? 1 : 0) - (a.attending ? 1 : 0));
  const rows = sorted.map((g, i) => [
    i + 1, g.full_name, g.phone || "",
    g.attending ? "✓ מגיע" : "✗ לא מגיע",
    g.attending ? g.guest_count : "-",
    new Date(g.created_at).toLocaleDateString("he-IL"),
  ]);
  downloadCSV([hdr, ...rows], "כל_האורחים.csv");
}

function exportAttending(guests) {
  const list = guests.filter((g) => g.attending);
  const hdr = ["#", "שם מלא", "טלפון", "מספר אורחים", "תאריך רישום"];
  const rows = list.map((g, i) => [
    i + 1, g.full_name, g.phone || "", g.guest_count,
    new Date(g.created_at).toLocaleDateString("he-IL"),
  ]);
  const totalRow = ["", "סה\"כ אורחים", "", list.reduce((s, g) => s + (g.guest_count || 1), 0), ""];
  downloadCSV([hdr, ...rows, ["", "", "", "", ""], totalRow], "מגיעים.csv");
}

function sendWhatsApp(guest, settings) {
  if (!guest.phone) return;
  const d = new Date(settings.WEDDING_DATE);
  const timeStr = d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
  const msg = `✨ הגיע הרגע! ✨

${guest.full_name} היקר/ה,

הגיע היום המיוחד — היום מתחתנים ${settings.COUPLE_NAMES}! 💍🎊

אנחנו כל כך שמחים שאתם חלק מהיום הזה ומחכים לראותכם!

📍 ${settings.VENUE_NAME}
🏠 ${settings.VENUE_ADDRESS}
⏰ קבלת פנים בשעה ${timeStr}

נסעו בזהירות ונתראה בשמחות! 🥂💕`;
  const phone = guest.phone.replace(/[^0-9]/g, "").replace(/^0/, "972");
  window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, "_blank");
}

function sendWhatsAppAll(guests, settings) {
  const withPhone = guests.filter(g => g.attending && g.phone);
  if (withPhone.length === 0) { alert("אין אורחים מגיעים עם מספר טלפון"); return; }
  // Open one at a time — user clicks each
  let i = 0;
  function next() {
    if (i >= withPhone.length) return;
    sendWhatsApp(withPhone[i], settings);
    i++;
    if (i < withPhone.length) {
      if (window.confirm(`נשלח ל-${withPhone[i-1].full_name} ✓

לחץ אישור לשליחה ל-${withPhone[i].full_name}`)) next();
    } else {
      alert(`הסתיים! נשלחו תזכורות ל-${withPhone.length} אורחים ✓`);
    }
  }
  if (window.confirm(`לשלוח תזכורת WhatsApp ל-${withPhone.length} אורחים?

תצטרך לאשר כל שליחה בנפרד.`)) next();
}

function exportNotAttending(guests) {
  const list = guests.filter((g) => !g.attending);
  const hdr = ["#", "שם מלא", "טלפון", "תאריך רישום"];
  const rows = list.map((g, i) => [
    i + 1, g.full_name, g.phone || "",
    new Date(g.created_at).toLocaleDateString("he-IL"),
  ]);
  downloadCSV([hdr, ...rows], "לא_מגיעים.csv");
}


function calendarLink(settings) {
  const fmt = (d) => d.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  const d = new Date(settings.WEDDING_DATE);
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent("חתונת " + settings.COUPLE_NAMES)}&dates=${fmt(d)}/${fmt(new Date(d.getTime() + 4 * 3600000))}&location=${encodeURIComponent(settings.VENUE_ADDRESS)}`;
}

// ── Shared UI ─────────────────────────────────────────────────────────────────
const FloralDivider = () => (
  <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "20px 0", justifyContent: "center", opacity: 0.6 }}>
    <div style={{ height: 1, flex: 1, background: "linear-gradient(to left, transparent, #c9a84c)" }} />
    <span style={{ color: "#c9a84c", fontSize: 22 }}>✦</span>
    <span style={{ color: "#c9a84c", fontSize: 16 }}>✿</span>
    <span style={{ color: "#c9a84c", fontSize: 22 }}>✦</span>
    <div style={{ height: 1, flex: 1, background: "linear-gradient(to right, transparent, #c9a84c)" }} />
  </div>
);

const Ring = ({ size = 60, style = {} }) => (
  <svg width={size} height={size} viewBox="0 0 60 60" fill="none" style={style}>
    <circle cx="30" cy="30" r="22" stroke="#c9a84c" strokeWidth="3" strokeDasharray="4 3" opacity="0.6" />
    <circle cx="30" cy="30" r="14" stroke="#c9a84c" strokeWidth="1.5" opacity="0.4" />
    <circle cx="30" cy="30" r="5" fill="#c9a84c" opacity="0.5" />
  </svg>
);

const CountUnit = ({ val, label }) => (
  <div style={{ textAlign: "center", minWidth: 64 }}>
    <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 42, fontWeight: 700, color: "#c9a84c", lineHeight: 1, textShadow: "0 2px 8px rgba(201,168,76,0.25)" }}>{String(val).padStart(2, "0")}</div>
    <div style={{ fontSize: 11, color: "#9a8060", marginTop: 4, letterSpacing: 2, textTransform: "uppercase" }}>{label}</div>
  </div>
);

function Field({ label, children }) {
  return (
    <div>
      <label style={{ fontSize: 12, color: "#7a6040", marginBottom: 5, display: "block", fontWeight: 700, letterSpacing: 0.5 }}>{label}</label>
      {children}
    </div>
  );
}

// ── RSVP Form ─────────────────────────────────────────────────────────────────
function RSVPForm({ onSuccess, settings, supabase }) {
  const [form, setForm] = useState({ full_name: "", phone: "", attending: true, guest_count: 1 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [focus, setFocus] = useState("");
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const iStyle = (k) => ({
    width: "100%", padding: "12px 14px", borderRadius: 10,
    border: `1.5px solid ${focus === k ? "#c9a84c" : "#e2d5b8"}`,
    background: "rgba(255,253,247,0.9)", fontSize: 14, color: "#3d2e1a",
    outline: "none", fontFamily: "inherit", direction: "rtl", transition: "border-color 0.2s",
  });

  const validatePhone = (phone) => {
    if (!phone) return true; // phone is optional
    const digits = phone.replace(/[^0-9]/g, "");
    if (!digits.startsWith("05") && !digits.startsWith("972")) return "מספר טלפון חייב להתחיל ב-05";
    if (digits.length < 10) return `חסרות ${10 - digits.length} ספרות במספר הטלפון`;
    if (digits.length > 10) return "מספר הטלפון ארוך מדי";
    return true;
  };

  const submit = async () => {
    if (!form.full_name.trim()) { setError("נא להזין שם מלא"); return; }
    const phoneCheck = validatePhone(form.phone);
    if (phoneCheck !== true) { setError(phoneCheck); return; }
    setLoading(true); setError("");
    const guest = {
      full_name: form.full_name.trim(),
      phone: form.phone || null,
      attending: form.attending,
      guest_count: Number(form.guest_count),
      created_at: new Date().toISOString(),
      id: crypto.randomUUID?.() || Math.random().toString(36).slice(2),
    };
    try {
      if (supabase) {
        await supabase.insert(guest);
      } else {
        lsSaveGuest(guest);
      }
      onSuccess(guest);
    } catch (e) {
      console.error(e);
      // Fallback: save locally even if Supabase fails
      lsSaveGuest(guest);
      onSuccess(guest);
    }
    setLoading(false);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Field label="שם מלא *">
        <input style={iStyle("name")} placeholder="הכניסו את שמכם המלא" value={form.full_name} onChange={(e) => set("full_name", e.target.value)} onFocus={() => setFocus("name")} onBlur={() => setFocus("")} />
      </Field>
      <Field label="מספר טלפון 📱">
        <div style={{ position: "relative" }}>
          <input
            style={{
              ...iStyle("phone"),
              paddingLeft: form.phone ? "36px" : "14px",
              borderColor: form.phone && validatePhone(form.phone) !== true ? "#e74c3c" : focus === "phone" ? "#c9a84c" : "#e2d5b8"
            }}
            placeholder="050-0000000"
            value={form.phone}
            onChange={(e) => set("phone", e.target.value)}
            onFocus={() => setFocus("phone")}
            onBlur={() => setFocus("")}
          />
          {form.phone && (
            <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", fontSize: 14 }}>
              {validatePhone(form.phone) === true ? "✅" : "❌"}
            </span>
          )}
        </div>
        {form.phone && validatePhone(form.phone) !== true && (
          <p style={{ fontSize: 11, color: "#e74c3c", marginTop: 4, marginRight: 2 }}>⚠️ {validatePhone(form.phone)}</p>
        )}
      </Field>
      <Field label="האם תגיעו?">
        <div style={{ display: "flex", gap: 10 }}>
          {[{ v: true, label: "✓ מגיע / מגיעה" }, { v: false, label: "✗ לא מגיע/ה" }].map(({ v, label }) => (
            <button key={String(v)} onClick={() => set("attending", v)} style={{ flex: 1, padding: "11px 8px", borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", border: form.attending === v ? "2px solid #c9a84c" : "1.5px solid #e2d5b8", background: form.attending === v ? "linear-gradient(135deg,#c9a84c,#e8c96a)" : "rgba(255,253,247,0.9)", color: form.attending === v ? "#fff" : "#7a6040", boxShadow: form.attending === v ? "0 4px 15px rgba(201,168,76,0.3)" : "none", transition: "all 0.2s" }}>{label}</button>
          ))}
        </div>
      </Field>
      {form.attending && (
        <Field label="מספר אורחים (כולל עצמכם)">
          <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <button key={n} onClick={() => set("guest_count", n)} style={{ width: 42, height: 42, borderRadius: "50%", fontWeight: 700, fontSize: 15, cursor: "pointer", fontFamily: "inherit", border: form.guest_count === n ? "2px solid #c9a84c" : "1.5px solid #e2d5b8", background: form.guest_count === n ? "linear-gradient(135deg,#c9a84c,#e8c96a)" : "rgba(255,253,247,0.9)", color: form.guest_count === n ? "#fff" : "#7a6040", boxShadow: form.guest_count === n ? "0 4px 12px rgba(201,168,76,0.35)" : "none", transition: "all 0.2s" }}>{n}</button>
            ))}
          </div>
        </Field>
      )}
      {error && <p style={{ color: "#c0392b", fontSize: 13, textAlign: "center" }}>{error}</p>}
      <button onClick={submit} disabled={loading} style={{ marginTop: 6, padding: "14px", borderRadius: 12, border: "none", background: loading ? "#d4c4a0" : "linear-gradient(135deg,#c9a84c 0%,#e8c96a 50%,#c9a84c 100%)", color: "#fff", fontSize: 16, fontWeight: 700, cursor: loading ? "not-allowed" : "pointer", fontFamily: "'Playfair Display', serif", boxShadow: "0 6px 24px rgba(201,168,76,0.35)", letterSpacing: 1 }}>{loading ? "שומר..." : "אישור הגעה ✦"}</button>
    </div>
  );
}

// ── Success Screen ─────────────────────────────────────────────────────────────
function SuccessScreen({ guest, settings }) {
  const d = new Date(settings.WEDDING_DATE);
  return (
    <div style={{ textAlign: "center", padding: "10px 0" }}>
      <div style={{ fontSize: 60, marginBottom: 10 }}>💍</div>
      <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: 28, color: "#c9a84c", marginBottom: 8 }}>{guest.attending ? "נשמח לראותכם!" : "תודה על העדכון"}</h2>
      <p style={{ color: "#7a6040", fontSize: 14, marginBottom: 20, lineHeight: 1.7 }}>{guest.attending ? `${guest.full_name}, אנחנו שמחים שתצטרפו אלינו!` : `${guest.full_name}, תודה על העדכון. נחמיץ אתכם!`}</p>
      {guest.attending && (
        <>
          <FloralDivider />
          <p style={{ fontSize: 13, color: "#9a8060", marginBottom: 6 }}>📅 {d.toLocaleDateString("he-IL", { weekday: "long", year: "numeric", month: "long", day: "numeric" })} | ⏰ {d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })}</p>
          <p style={{ fontSize: 13, color: "#9a8060", marginBottom: 20 }}>📍 {settings.VENUE_NAME}</p>
          <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
            <a href={calendarLink(settings)} target="_blank" rel="noreferrer" style={{ padding: "11px 20px", borderRadius: 10, textDecoration: "none", background: "linear-gradient(135deg,#c9a84c,#e8c96a)", color: "#fff", fontSize: 13, fontWeight: 700 }}>📅 הוסף ליומן</a>
            <a href={settings.WAZE_LINK} target="_blank" rel="noreferrer" style={{ padding: "11px 20px", borderRadius: 10, textDecoration: "none", background: "linear-gradient(135deg,#33ccff,#1a99cc)", color: "#fff", fontSize: 13, fontWeight: 700 }}>🧭 נווט ב-Waze</a>
            {settings.BIT_PHONE && (
              <a href={`https://www.bitpay.co.il/app/pay?phoneNumber=${(settings.BIT_PHONE||"").replace(/-/g,"")}`} target="_blank" rel="noreferrer" style={{ padding:"11px 20px", borderRadius:10, textDecoration:"none", background:"linear-gradient(135deg,#27ae60,#2ecc71)", color:"#fff", fontSize:13, fontWeight:700, boxShadow:"0 4px 14px rgba(39,174,96,0.25)" }}>💳 שלח מתנה בביט</a>
            )}
            {settings.PAYBOX_PHONE && (
              <a href={`https://payboxapp.page.link/pay?to=972${(settings.PAYBOX_PHONE||"").replace(/^0/,"").replace(/-/g,"")}`} target="_blank" rel="noreferrer" style={{ padding:"11px 20px", borderRadius:10, textDecoration:"none", background:"linear-gradient(135deg,#6c3ce1,#9b59b6)", color:"#fff", fontSize:13, fontWeight:700, boxShadow:"0 4px 14px rgba(108,60,225,0.25)" }}>📦 שלח מתנה בPayBox</a>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ── Settings Editor ───────────────────────────────────────────────────────────
// ── SettingsField — outside component so React never re-mounts it on keystroke
const sInputStyle = { width:"100%", padding:"10px 14px", borderRadius:10, border:"1.5px solid #e2d5b8", background:"rgba(255,253,247,0.9)", fontSize:14, color:"#3d2e1a", outline:"none", fontFamily:"inherit", transition:"border-color 0.2s" };
function SF({ label, name, type="text", placeholder="", defaultValue="", inputRef }) {
  return (
    <Field label={label}>
      <input
        ref={inputRef}
        type={type}
        defaultValue={defaultValue}
        placeholder={placeholder}
        style={{ ...sInputStyle, direction: type==="date"||type==="time" ? "ltr" : "rtl", textAlign: type==="date"||type==="time" ? "left" : "right" }}
        onFocus={(e) => e.target.style.borderColor="#c9a84c"}
        onBlur={(e) => e.target.style.borderColor="#e2d5b8"}
      />
    </Field>
  );
}

function SettingsEditor({ settings, onSave }) {
  const [saved, setSaved] = useState(false);
  const refs = useRef({});
  const setRef = (name) => (el) => { refs.current[name] = el; };

  const handleSave = () => {
    const updated = { ...settings };
    Object.keys(refs.current).forEach((k) => {
      if (k !== "WEDDING_TIME" && refs.current[k]) updated[k] = refs.current[k].value;
    });
    const dateVal = refs.current["WEDDING_DATE"]?.value || "";
    const timeVal = refs.current["WEDDING_TIME"]?.value || "18:00";
    if (dateVal) updated["WEDDING_DATE"] = dateVal + "T" + timeVal;
    onSave(updated);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const handleReset = () => {
    if (window.confirm("לאפס את כל ההגדרות לברירת מחדל?")) {
      Object.keys(refs.current).forEach((k) => { if (refs.current[k]) refs.current[k].value = DEFAULT_SETTINGS[k] || ""; });
    }
  };

  const SectionTitle = ({ children }) => (
    <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "22px 0 14px" }}>
      <div style={{ height: 1, flex: 1, background: "linear-gradient(to left,transparent,#e2d5b8)" }} />
      <span style={{ fontSize: 10, color: "#c9a84c", fontWeight: 800, letterSpacing: 2.5, textTransform: "uppercase", whiteSpace: "nowrap" }}>{children}</span>
      <div style={{ height: 1, flex: 1, background: "linear-gradient(to right,transparent,#e2d5b8)" }} />
    </div>
  );

  return (
    <div style={{ direction: "rtl" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
        <span style={{ fontSize: 26 }}>⚙️</span>
        <div>
          <h3 style={{ fontFamily: "'Playfair Display', serif", fontSize: 20, color: "#3d2e1a", margin: 0 }}>הגדרות האירוע</h3>
          <p style={{ fontSize: 11, color: "#9a8060", margin: 0 }}>הקלד ולחץ שמור — השינויים יתעדכנו מיד</p>
        </div>
      </div>

      <SectionTitle>💑 פרטי הזוג</SectionTitle>
      <SF label="שמות החתן והכלה" name="COUPLE_NAMES" placeholder="שם & שם" defaultValue={settings.COUPLE_NAMES || ""} inputRef={setRef("COUPLE_NAMES")} />

      <SectionTitle>📅 תאריך ושעה</SectionTitle>
      <div style={{ display: "flex", gap: 10 }}>
        <SF label="תאריך 📅" name="WEDDING_DATE" type="date"
          defaultValue={settings.WEDDING_DATE ? settings.WEDDING_DATE.split("T")[0] : ""}
          inputRef={setRef("WEDDING_DATE")} />
        <SF label="שעה ⏰" name="WEDDING_TIME" type="time"
          defaultValue={settings.WEDDING_DATE && settings.WEDDING_DATE.includes("T") ? settings.WEDDING_DATE.split("T")[1].slice(0,5) : "18:00"}
          inputRef={setRef("WEDDING_TIME")} />
      </div>

      <SectionTitle>🏛 מיקום האירוע</SectionTitle>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <SF label="שם האולם" name="VENUE_NAME" placeholder="שם האולם, עיר" defaultValue={settings.VENUE_NAME || ""} inputRef={setRef("VENUE_NAME")} />
        <SF label="כתובת מלאה" name="VENUE_ADDRESS" placeholder="רחוב, מספר, עיר" defaultValue={settings.VENUE_ADDRESS || ""} inputRef={setRef("VENUE_ADDRESS")} />
        <SF label="קישור Waze 🧭" name="WAZE_LINK" placeholder="https://waze.com/ul?..." defaultValue={settings.WAZE_LINK || ""} inputRef={setRef("WAZE_LINK")} />
        <SF label="מספר טלפון לביט 💳 (אופציונלי)" name="BIT_PHONE" placeholder="050-0000000" defaultValue={settings.BIT_PHONE || ""} inputRef={setRef("BIT_PHONE")} />
        <SF label="מספר טלפון לPayBox 📦 (אופציונלי)" name="PAYBOX_PHONE" placeholder="050-0000000" defaultValue={settings.PAYBOX_PHONE || ""} inputRef={setRef("PAYBOX_PHONE")} />
      </div>

      <SectionTitle>🔐 הגדרות מערכת</SectionTitle>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <SF label="סיסמת אדמין" name="ADMIN_PASSWORD" type="password" defaultValue={settings.ADMIN_PASSWORD || ""} inputRef={setRef("ADMIN_PASSWORD")} />
        <SF label="Supabase URL" name="SUPABASE_URL" placeholder="https://xxx.supabase.co" defaultValue={settings.SUPABASE_URL || ""} inputRef={setRef("SUPABASE_URL")} />
        <SF label="Supabase Anon Key" name="SUPABASE_ANON_KEY" placeholder="eyJhbGci..." defaultValue={settings.SUPABASE_ANON_KEY || ""} inputRef={setRef("SUPABASE_ANON_KEY")} />
      </div>

      <div style={{ marginTop: 20, display: "flex", gap: 10 }}>
        <button onClick={handleSave} style={{ flex: 1, padding: "13px", borderRadius: 12, border: "none", background: saved ? "linear-gradient(135deg,#27ae60,#2ecc71)" : "linear-gradient(135deg,#c9a84c,#e8c96a)", color: "#fff", fontSize: 15, fontWeight: 700, cursor: "pointer", fontFamily: "'Playfair Display', serif", boxShadow: "0 4px 16px rgba(201,168,76,0.3)", transition: "all 0.35s" }}>
          {saved ? "✓ נשמר בהצלחה!" : "💾 שמור שינויים"}
        </button>
        <button onClick={handleReset} style={{ padding: "13px 16px", borderRadius: 12, border: "1.5px solid #e2d5b8", background: "#fff", color: "#9a8060", fontSize: 13, cursor: "pointer", fontFamily: "inherit" }} title="איפוס">↩</button>
      </div>

      {saved && (
        <div style={{ marginTop: 12, padding: "10px 16px", borderRadius: 10, background: "rgba(39,174,96,0.1)", border: "1px solid rgba(39,174,96,0.25)", color: "#27ae60", fontSize: 13, textAlign: "center" }}>
          ✅ ההגדרות עודכנו — הדף מעודכן כעת!
        </div>
      )}
    </div>
  );
}

// ── Admin Dashboard ────────────────────────────────────────────────────────────
function AdminDashboard({ settings, onSettingsSave, supabase }) {
  const [tab, setTab] = useState("guests");
  const [guests, setGuests] = useState([]);
  const [loading, setLoading] = useState(true);

  const supabaseRef = useRef(supabase);
  useEffect(() => { supabaseRef.current = supabase; }, [supabase]);

  const [loadError, setLoadError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const sb = supabaseRef.current;
      if (sb) {
        const data = await sb.select();
        setGuests(data || []);
      } else {
        setGuests(lsGetGuests());
      }
    } catch (e) {
      console.error("Load error:", e);
      setLoadError("שגיאה בטעינה מ-Supabase: " + e.message);
      setGuests(lsGetGuests());
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (tab === "guests") load();
  }, [tab]);

  const attending = guests.filter((g) => g.attending);
  const totalConfirmed = attending.reduce((s, g) => s + (g.guest_count || 1), 0);
  const pct = guests.length > 0 ? Math.round((attending.length / guests.length) * 100) : 0;

  const cardStyle = { background: "rgba(255,253,247,0.95)", borderRadius: 14, padding: "16px 18px", border: "1px solid #e2d5b8", boxShadow: "0 4px 20px rgba(201,168,76,0.08)", textAlign: "center" };

  const TabBtn = ({ id, icon, label }) => (
    <button onClick={() => setTab(id)} style={{ flex: 1, padding: "10px 6px", borderRadius: 10, border: "none", fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer", transition: "all 0.2s", background: tab === id ? "linear-gradient(135deg,#c9a84c,#e8c96a)" : "transparent", color: tab === id ? "#fff" : "#9a8060", boxShadow: tab === id ? "0 3px 10px rgba(201,168,76,0.25)" : "none" }}>
      <span style={{ marginLeft: 4 }}>{icon}</span>{label}
    </button>
  );

  return (
    <div style={{ direction: "rtl" }}>
      <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: 22, color: "#3d2e1a", marginBottom: 14, textAlign: "center" }}>✦ לוח ניהול</h2>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 6, background: "rgba(242,234,215,0.5)", borderRadius: 12, padding: 5, marginBottom: 20 }}>
        <TabBtn id="guests" icon="👥" label="רשימת אורחים" />
        <TabBtn id="settings" icon="⚙️" label="הגדרות האירוע" />
      </div>

      {/* GUESTS TAB */}
      {tab === "guests" && (
        <>
          {/* Export buttons */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
            <button onClick={load} style={{ padding: "8px 12px", borderRadius: 9, border: "1.5px solid #e2d5b8", background: "#fff", color: "#7a6040", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>🔄 רענן</button>
            <button onClick={() => {
              if (window.confirm("לנקות נתונים ישנים ולטעון מחדש מ-Supabase?")) {
                localStorage.removeItem("wedding_guests");
                load();
              }
            }} style={{ padding: "8px 12px", borderRadius: 9, border: "1.5px solid #e2d5b8", background: "#fff", color: "#c0392b", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>🗑️ נקה מטמון</button>
            <div style={{ flex: 1 }} />
            <button onClick={() => exportAll(guests)} style={{ padding: "8px 12px", borderRadius: 9, border: "none", background: "linear-gradient(135deg,#7a6040,#a08050)", color: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 700, boxShadow: "0 3px 8px rgba(122,96,64,0.25)" }}>📋 כולם</button>
            <button onClick={() => exportAttending(guests)} style={{ padding: "8px 12px", borderRadius: 9, border: "none", background: "linear-gradient(135deg,#27ae60,#2ecc71)", color: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 700, boxShadow: "0 3px 8px rgba(39,174,96,0.25)" }}>✅ מגיעים</button>
            <button onClick={() => exportNotAttending(guests)} style={{ padding: "8px 12px", borderRadius: 9, border: "none", background: "linear-gradient(135deg,#e74c3c,#c0392b)", color: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 700, boxShadow: "0 3px 8px rgba(231,76,60,0.25)" }}>❌ לא מגיעים</button>
          </div>
          {/* WhatsApp reminder */}
          <div style={{ background: "rgba(37,211,102,0.08)", border: "1px solid rgba(37,211,102,0.25)", borderRadius: 12, padding: "12px 14px", marginBottom: 14, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <div>
              <p style={{ fontSize: 13, fontWeight: 700, color: "#1a7a3c", margin: 0 }}>📱 תזכורת WhatsApp לאורחים</p>
              <p style={{ fontSize: 11, color: "#5a9a6a", margin: 0, marginTop: 2 }}>שולח הודעה אישית לכל מגיע עם מספר טלפון</p>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={() => sendWhatsAppAll(guests, settings)}
                style={{ padding: "9px 16px", borderRadius: 9, border: "none", background: "linear-gradient(135deg,#25d366,#128c7e)", color: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 700, boxShadow: "0 3px 10px rgba(37,211,102,0.35)", whiteSpace: "nowrap" }}
              >📲 שלח לכולם</button>
            </div>
          </div>


          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(120px,1fr))", gap: 10, marginBottom: 14 }}>
            {[{ label: "סה\"כ רישומים", val: guests.length, icon: "📋" }, { label: "מגיעים", val: attending.length, icon: "✅" }, { label: "לא מגיעים", val: guests.length - attending.length, icon: "❌" }, { label: "סה\"כ אורחים", val: totalConfirmed, icon: "👥" }].map(({ label, val, icon }) => (
              <div key={label} style={cardStyle}>
                <div style={{ fontSize: 22, marginBottom: 4 }}>{icon}</div>
                <div style={{ fontSize: 26, fontWeight: 800, color: "#c9a84c", fontFamily: "'Playfair Display', serif" }}>{val}</div>
                <div style={{ fontSize: 10, color: "#9a8060", marginTop: 2 }}>{label}</div>
              </div>
            ))}
          </div>

          <div style={{ ...cardStyle, textAlign: "right", marginBottom: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 7 }}>
              <span style={{ fontSize: 13, color: "#7a6040", fontWeight: 600 }}>אחוז המגיעים</span>
              <span style={{ fontSize: 18, fontWeight: 800, color: "#c9a84c", fontFamily: "'Playfair Display', serif" }}>{pct}%</span>
            </div>
            <div style={{ height: 9, borderRadius: 99, background: "#f0e8d4", overflow: "hidden" }}>
              <div style={{ height: "100%", borderRadius: 99, width: `${pct}%`, background: "linear-gradient(90deg,#c9a84c,#e8c96a)", transition: "width 1s ease" }} />
            </div>
          </div>

          {loadError && (
            <div style={{ padding: "10px 14px", borderRadius: 10, background: "rgba(231,76,60,0.1)", border: "1px solid rgba(231,76,60,0.3)", color: "#c0392b", fontSize: 12, marginBottom: 12, textAlign: "center" }}>
              ⚠️ {loadError}
            </div>
          )}
          {loading ? (
            <div style={{ textAlign: "center", padding: 32, color: "#c9a84c" }}>טוען...</div>
          ) : guests.length === 0 ? (
            <div style={{ ...cardStyle, color: "#9a8060", padding: 32 }}>עדיין אין רישומים 🕊</div>
          ) : (
            <div style={{ overflowX: "auto", borderRadius: 14, border: "1px solid #e2d5b8" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "linear-gradient(135deg,#c9a84c,#e8c96a)" }}>
                    {["שם מלא", "טלפון", "סטטוס", "אורחים", "תאריך", ""].map((h) => (
                      <th key={h} style={{ padding: "11px 12px", color: "#fff", fontWeight: 700, textAlign: "right", whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {guests.map((g, i) => (
                    <tr key={g.id || i} style={{ background: i % 2 === 0 ? "rgba(255,253,247,0.95)" : "rgba(242,234,215,0.4)" }}>
                      <td style={{ padding: "10px 12px", color: "#3d2e1a", fontWeight: 600 }}>{g.full_name}</td>
                      <td style={{ padding: "10px 12px", color: "#7a6040" }}>{g.phone || "—"}</td>
                      <td style={{ padding: "10px 12px" }}>
                        <span style={{ padding: "3px 10px", borderRadius: 99, fontSize: 11, fontWeight: 700, background: g.attending ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.1)", color: g.attending ? "#16a34a" : "#dc2626" }}>{g.attending ? "✓ מגיע" : "✗ לא מגיע"}</span>
                      </td>
                      <td style={{ padding: "10px 12px", color: "#7a6040", textAlign: "center" }}>{g.attending ? g.guest_count : "—"}</td>
                      <td style={{ padding: "10px 12px", color: "#9a8060", fontSize: 11, whiteSpace: "nowrap" }}>{new Date(g.created_at).toLocaleDateString("he-IL")}</td>
                      <td style={{ padding: "10px 8px" }}>
                        {g.phone && g.attending && (
                          <button onClick={() => sendWhatsApp(g, settings)} style={{ padding: "4px 10px", borderRadius: 7, border: "none", background: "linear-gradient(135deg,#25d366,#128c7e)", color: "#fff", cursor: "pointer", fontSize: 11, fontWeight: 700 }}>📲</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {tab === "settings" && <SettingsEditor settings={settings} onSave={onSettingsSave} />}
    </div>
  );
}

// ── Admin Password Gate ────────────────────────────────────────────────────────
function AdminGate({ onEnter, settings }) {
  const [pw, setPw] = useState(""); const [err, setErr] = useState(false);
  const check = () => { if (pw === settings.ADMIN_PASSWORD) onEnter(); else { setErr(true); setTimeout(() => setErr(false), 1500); } };
  return (
    <div style={{ textAlign: "center", padding: "20px 0" }}>
      <div style={{ fontSize: 40, marginBottom: 12 }}>🔐</div>
      <h3 style={{ fontFamily: "'Playfair Display', serif", color: "#3d2e1a", marginBottom: 20 }}>כניסת מנהל</h3>
      <input type="password" placeholder="סיסמה" value={pw} onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === "Enter" && check()}
        style={{ padding: "11px 16px", borderRadius: 10, fontSize: 15, direction: "rtl", border: `1.5px solid ${err ? "#e74c3c" : "#e2d5b8"}`, background: "#fffdf7", outline: "none", fontFamily: "inherit", width: "100%", maxWidth: 240, marginBottom: 12, transition: "border-color 0.2s" }} />
      <br />
      <button onClick={check} style={{ marginTop: 4, padding: "11px 32px", borderRadius: 10, border: "none", background: "linear-gradient(135deg,#c9a84c,#e8c96a)", color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: 14 }}>כניסה</button>
      {err && <p style={{ color: "#e74c3c", fontSize: 13, marginTop: 8 }}>סיסמה שגויה</p>}

    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function WeddingRSVP() {
  const [settings, setSettings] = useState(loadSettings);
  const [view, setView] = useState("rsvp");
  const [submittedGuest, setSubmittedGuest] = useState(null);
  const [adminUnlocked, setAdminUnlocked] = useState(false);

  const supabase = useMemo(() => createSupabaseClient(settings.SUPABASE_URL, settings.SUPABASE_ANON_KEY), [settings.SUPABASE_URL, settings.SUPABASE_ANON_KEY]);
  const countdown = useCountdown(settings.WEDDING_DATE);
  const weddingDate = new Date(settings.WEDDING_DATE);

  const handleSettingsSave = (newSettings) => {
    saveSettings(newSettings);
    setSettings(newSettings);
  };

  const particles = Array.from({ length: 18 }, (_, i) => ({
    id: i, x: (i * 17 + 13) % 100, y: (i * 23 + 7) % 100,
    size: 4 + (i % 5) * 1.5, delay: (i * 0.7) % 8, dur: 6 + (i % 5) * 1.6,
  }));

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;1,400&family=Assistant:wght@400;600&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { direction: rtl; font-family: 'Assistant', sans-serif; }
        @keyframes float { 0%,100%{transform:translateY(0) rotate(0deg);opacity:0.4} 50%{transform:translateY(-28px) rotate(12deg);opacity:0.75} }
        @keyframes fadeIn { from{opacity:0;transform:translateY(18px)} to{opacity:1;transform:translateY(0)} }
        @keyframes shimmer { 0%{background-position:200% center} 100%{background-position:-200% center} }
        .card-anim { animation: fadeIn 0.6s ease both; }
        .shimmer-text { background: linear-gradient(90deg,#c9a84c,#f5d98b,#c9a84c,#e8c96a); background-size:200% auto; -webkit-background-clip:text; -webkit-text-fill-color:transparent; animation:shimmer 4s linear infinite; }
      `}</style>

      <div style={{ minHeight: "100vh", background: "linear-gradient(160deg,#fdf8ef 0%,#f5ece0 40%,#ede0cc 100%)", position: "relative", overflow: "hidden" }}>
        <div style={{ position: "fixed", top: -120, right: -120, width: 400, height: 400, borderRadius: "50%", background: "radial-gradient(circle,rgba(201,168,76,0.12) 0%,transparent 70%)", pointerEvents: "none" }} />
        <div style={{ position: "fixed", bottom: -100, left: -100, width: 350, height: 350, borderRadius: "50%", background: "radial-gradient(circle,rgba(201,168,76,0.09) 0%,transparent 70%)", pointerEvents: "none" }} />
        {particles.map((p) => (
          <div key={p.id} style={{ position: "fixed", left: `${p.x}%`, top: `${p.y}%`, width: p.size, height: p.size, borderRadius: "50%", background: "rgba(201,168,76,0.22)", animation: `float ${p.dur}s ${p.delay}s ease-in-out infinite`, pointerEvents: "none" }} />
        ))}

        <div style={{ position: "relative", zIndex: 1, padding: "36px 16px 60px", maxWidth: 620, margin: "0 auto" }}>

          {/* Header */}
          <div style={{ textAlign: "center", marginBottom: 28 }} className="card-anim">
            <div style={{ display: "flex", justifyContent: "center", gap: 18, marginBottom: 16 }}>
              <Ring size={46} style={{ opacity: 0.7 }} />
              <Ring size={64} />
              <Ring size={46} style={{ opacity: 0.7 }} />
            </div>
            <p style={{ fontSize: 12, letterSpacing: 4, color: "#9a8060", textTransform: "uppercase", marginBottom: 8 }}>אתם מוזמנים לחתונה של</p>
            <h1 className="shimmer-text" style={{ fontFamily: "'Playfair Display', serif", fontSize: "clamp(32px,9vw,56px)", fontWeight: 700, lineHeight: 1.1, marginBottom: 6 }}>{settings.COUPLE_NAMES}</h1>
            <p style={{ fontSize: 13, color: "#9a8060" }}>
              {weddingDate.toLocaleDateString("he-IL", { weekday: "long", year: "numeric", month: "long", day: "numeric" })} | {settings.VENUE_NAME}
            </p>
          </div>

          {/* Countdown + Action Buttons */}
          <div style={{ background: "rgba(255,253,247,0.7)", backdropFilter: "blur(10px)", borderRadius: 18, padding: "20px 24px 22px", marginBottom: 22, border: "1px solid rgba(201,168,76,0.25)", boxShadow: "0 8px 32px rgba(201,168,76,0.1)" }} className="card-anim">
            {/* Countdown row - RTL: ימים שעות דקות שניות */}
            <div style={{ direction: "rtl", display: "flex", justifyContent: "center", alignItems: "flex-start", gap: 8, flexWrap: "wrap", marginBottom: 18 }}>
              <CountUnit val={countdown.s} label="שניות" />
              <div style={{ color: "#c9a84c", fontSize: 34, fontFamily: "'Playfair Display', serif", paddingTop: 3 }}>:</div>
              <CountUnit val={countdown.m} label="דקות" />
              <div style={{ color: "#c9a84c", fontSize: 34, fontFamily: "'Playfair Display', serif", paddingTop: 3 }}>:</div>
              <CountUnit val={countdown.h} label="שעות" />
              <div style={{ color: "#c9a84c", fontSize: 34, fontFamily: "'Playfair Display', serif", paddingTop: 3 }}>:</div>
              <CountUnit val={countdown.d} label="ימים" />
            </div>
          </div>

          {/* Main Card */}
          <div style={{ background: "rgba(255,253,247,0.92)", backdropFilter: "blur(16px)", borderRadius: 22, padding: "30px 26px", border: "1px solid rgba(201,168,76,0.2)", boxShadow: "0 16px 48px rgba(100,70,20,0.1)" }} className="card-anim">
            {view === "rsvp" && (
              <>
                <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: 24, color: "#3d2e1a", marginBottom: 4, textAlign: "center" }}>אישור הגעה</h2>
                <p style={{ color: "#9a8060", fontSize: 13, textAlign: "center", marginBottom: 4 }}>נשמח אם תאשרו השתתפותכם</p>
                <FloralDivider />
                <RSVPForm onSuccess={(g) => { setSubmittedGuest(g); setView("success"); }} settings={settings} supabase={supabase} />
                <div style={{ marginTop: 14, height: 1, background: "linear-gradient(to right,transparent,rgba(201,168,76,0.3),transparent)" }} />
                <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap", marginTop: 14 }}>
                  <a href={calendarLink(settings)} target="_blank" rel="noreferrer" style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "11px 16px", borderRadius: 12, textDecoration: "none", background: "linear-gradient(135deg,#c9a84c,#e8c96a)", color: "#fff", fontSize: 14, fontWeight: 700, boxShadow: "0 4px 14px rgba(201,168,76,0.25)", fontFamily: "'Assistant', sans-serif" }}>📅 הוסף ליומן</a>
                  <a href={settings.WAZE_LINK} target="_blank" rel="noreferrer" style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "11px 16px", borderRadius: 12, textDecoration: "none", background: "linear-gradient(135deg,#33ccff,#1a99cc)", color: "#fff", fontSize: 14, fontWeight: 700, boxShadow: "0 4px 14px rgba(51,204,255,0.25)", fontFamily: "'Assistant', sans-serif" }}>🧭 נווט ב-Waze</a>
                  {settings.BIT_PHONE && (
                    <a href={`https://www.bitpay.co.il/app/pay?phoneNumber=${(settings.BIT_PHONE||"").replace(/-/g,"")}`} target="_blank" rel="noreferrer" style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center", gap:6, padding:"11px 16px", borderRadius:12, textDecoration:"none", background:"linear-gradient(135deg,#27ae60,#2ecc71)", color:"#fff", fontSize:14, fontWeight:700, boxShadow:"0 4px 14px rgba(39,174,96,0.25)", fontFamily:"'Assistant', sans-serif" }}>💳 שלח מתנה בביט</a>
                  )}
                  {settings.PAYBOX_PHONE && (
                    <a href={`https://payboxapp.page.link/pay?to=972${(settings.PAYBOX_PHONE||"").replace(/^0/,"").replace(/-/g,"")}`} target="_blank" rel="noreferrer" style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center", gap:6, padding:"11px 16px", borderRadius:12, textDecoration:"none", background:"linear-gradient(135deg,#6c3ce1,#9b59b6)", color:"#fff", fontSize:14, fontWeight:700, boxShadow:"0 4px 14px rgba(108,60,225,0.25)", fontFamily:"'Assistant', sans-serif" }}>📦 שלח מתנה בPayBox</a>
                  )}
                </div>
              </>
            )}
            {view === "success" && submittedGuest && <SuccessScreen guest={submittedGuest} settings={settings} />}
            {view === "admin-gate" && !adminUnlocked && <AdminGate settings={settings} onEnter={() => { setAdminUnlocked(true); setView("admin"); }} />}
            {view === "admin" && adminUnlocked && <AdminDashboard settings={settings} onSettingsSave={handleSettingsSave} supabase={supabase} />}
          </div>

          {/* Footer nav */}
          <div style={{ textAlign: "center", marginTop: 22, display: "flex", justifyContent: "center", gap: 16, flexWrap: "wrap" }}>
            {view !== "rsvp" && view !== "success" && (
              <button onClick={() => setView("rsvp")} style={{ background: "none", border: "none", color: "#c9a84c", cursor: "pointer", fontSize: 13, fontWeight: 600, textDecoration: "underline" }}>← חזרה לטופס</button>
            )}
            {view === "success" && (
              <button onClick={() => setView("rsvp")} style={{ background: "none", border: "none", color: "#c9a84c", cursor: "pointer", fontSize: 13, fontWeight: 600, textDecoration: "underline" }}>רישום נוסף</button>
            )}
            <button onClick={() => { if (adminUnlocked) setView(view === "admin" ? "rsvp" : "admin"); else setView("admin-gate"); }} style={{ background: "none", border: "none", color: "#9a8060", cursor: "pointer", fontSize: 12, opacity: 0.55 }}>
              {view === "admin" ? "← יציאה מניהול" : "🔐 ניהול"}
            </button>
          </div>
          <p style={{ textAlign: "center", marginTop: 18, fontSize: 11, color: "#c0aa80", letterSpacing: 1 }}>{supabase ? "✦ מחובר ל-Supabase ✦" : "✦ מצב דמו (localStorage) ✦"}</p>
        </div>
      </div>
    </>
  );
}
