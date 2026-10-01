CREATE TABLE IF NOT EXISTS users (
    user_id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS user_gets (
    ugets_id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(user_id),
    magic_link TEXT NOT NULL,
    magic_link_hash TEXT NOT NULL,
    encoding TEXT
);

CREATE TABLE IF NOT EXISTS user_flags (
    flag_id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(user_id),
    flag TEXT NOT NULL,
    flag_hash TEXT,
    is_used BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS pastes (
    paste_id SERIAL PRIMARY KEY,
    flag_id INTEGER NOT NULL REFERENCES user_flags(flag_id),
    directory TEXT,
    encoded_str TEXT,
    encoding_type TEXT,
    pastebin_url TEXT
);

CREATE TABLE IF NOT EXISTS tickets (
    ticket_id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(user_id),
    flag_id INTEGER NOT NULL REFERENCES user_flags(flag_id),
    jwt_token TEXT NOT NULL,
    qr_path TEXT,
    is_used BOOLEAN NOT NULL DEFAULT FALSE,
    issued_at TIMESTAMP NOT NULL DEFAULT NOW()
);

