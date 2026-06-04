import sqlite3
conn = sqlite3.connect("/usr/local/evotown/data/accounts.db")
conn.row_factory = sqlite3.Row

print("=== ACCOUNTS ===")
for r in conn.execute("SELECT * FROM gateway_accounts").fetchall():
    print(dict(r))

print("\n=== API KEYS ===")
for r in conn.execute("SELECT key_id, account_id, label, key_prefix, scopes, created_at FROM gateway_api_keys").fetchall():
    print(dict(r))
