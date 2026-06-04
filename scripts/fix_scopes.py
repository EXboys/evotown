import sqlite3

conn = sqlite3.connect("/usr/local/evotown/data/accounts.db")

# Update the two keys missing console.write
keys_to_fix = ["key_33991ecaa5c1", "key_68c98bd68e4e"]
new_scopes = '["gateway.chat","console.read","console.write"]'

for key_id in keys_to_fix:
    old = conn.execute("SELECT scopes FROM gateway_api_keys WHERE key_id=?", (key_id,)).fetchone()
    if old:
        conn.execute("UPDATE gateway_api_keys SET scopes=? WHERE key_id=?", (new_scopes, key_id))
        print(f"Updated {key_id}: {old[0]} -> {new_scopes}")
    else:
        print(f"Key {key_id} not found")

conn.commit()

# Verify
print("\n=== All keys after fix ===")
for r in conn.execute("SELECT key_id, key_prefix, scopes FROM gateway_api_keys").fetchall():
    print(f"  {r[0]} ({r[1]}): {r[2]}")
