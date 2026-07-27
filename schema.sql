-- phobiafree.life — D1 schema
-- Reconstructed from CREATE TABLE / ALTER TABLE statements scattered across
-- install.php, cursor_track.php, visitor_log.php, admin.php, consult_handler.php,
-- payment.php, leave_message.php, migrate.php, migrate2.php.
-- Converted from MySQL to SQLite/D1 syntax.

-- ── Visitor tracking ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS visitor_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vid TEXT NOT NULL UNIQUE,
    ip TEXT,
    location TEXT,
    device TEXT,
    first_seen TEXT,
    last_seen TEXT,
    total_seconds INTEGER DEFAULT 0,
    pages TEXT,
    archived INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS session_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vid TEXT NOT NULL,
    snapshot TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_snapshots_vid ON session_snapshots (vid);
CREATE INDEX IF NOT EXISTS idx_snapshots_created ON session_snapshots (created_at);

-- chat_messages: created historically by install.php but NOT used by the live
-- chat (chat_handler.php stores chats as flat JSON files instead). Kept here
-- in case you want to migrate live chat onto D1 properly; otherwise drop it.
CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vid TEXT NOT NULL,
    site TEXT NOT NULL DEFAULT '',
    sender TEXT NOT NULL,
    type TEXT DEFAULT 'text',
    body TEXT,
    url TEXT,
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_vid ON chat_messages (vid);
CREATE INDEX IF NOT EXISTS idx_chat_created ON chat_messages (created_at);

-- ── Booking / consultations ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS consultations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT,
    phobia TEXT,
    appointment_dt TEXT NOT NULL,
    notes TEXT,
    q_duration TEXT,
    q_intensity TEXT,
    q_interference TEXT,
    q_cause TEXT,
    q_impact TEXT,
    q_cost TEXT,
    q_outcome TEXT,
    q_previous TEXT,
    google_event_id TEXT,
    ip_address TEXT,
    sms_consent INTEGER DEFAULT 0,
    consent_timestamp TEXT,
    status TEXT DEFAULT 'pending',
    archived INTEGER DEFAULT 0,
    submitted_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS blocked_slots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    blocked_dt TEXT NOT NULL,
    reason TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS therapy_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    consultation_id INTEGER,
    client_name TEXT,
    client_email TEXT,
    client_phone TEXT,
    session_dt TEXT NOT NULL,
    zoom_link TEXT,
    notes TEXT,
    status TEXT DEFAULT 'scheduled',
    gcal_event_id TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    consultation_id INTEGER UNIQUE,
    first_name TEXT,
    last_name TEXT,
    email TEXT,
    phone TEXT,
    phobia TEXT,
    q_intensity TEXT,
    archived INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- ── Payments ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payment_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token TEXT NOT NULL UNIQUE,
    consultation_id INTEGER,
    client_name TEXT,
    client_email TEXT,
    amount_cents INTEGER NOT NULL,
    description TEXT,
    used INTEGER DEFAULT 0,
    paid INTEGER DEFAULT 0,
    stripe_payment_intent TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    paid_at TEXT,
    link_type TEXT DEFAULT 'standard',
    price_reason TEXT,
    FOREIGN KEY (consultation_id) REFERENCES consultations(id)
);

-- ── Contact / misc ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS visitor_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    email TEXT,
    message TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Signed testimonial / media releases (written, video, etc.)
CREATE TABLE IF NOT EXISTS testimonial_releases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT,
    display_name TEXT,
    media_types TEXT,
    notes TEXT,
    agreement_version TEXT,
    signature_data TEXT,
    page_url TEXT,
    ip_address TEXT,
    user_agent TEXT,
    signed_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS settings (
    setting_key TEXT PRIMARY KEY,
    setting_value TEXT
);

-- Seed defaults (mirrors admin.php's INSERT IGNORE seeding)
INSERT OR IGNORE INTO settings (setting_key, setting_value) VALUES ('admin_password', 'CHANGE_ME');
INSERT OR IGNORE INTO settings (setting_key, setting_value) VALUES ('hours_windows', '13-15,19-21');
INSERT OR IGNORE INTO settings (setting_key, setting_value) VALUES ('default_price_cents', '27900');
