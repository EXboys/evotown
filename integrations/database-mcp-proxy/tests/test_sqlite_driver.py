import sqlite3
import tempfile
import unittest

from database_mcp_proxy.drivers import list_tables, run_query


class SqliteDriverTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmpdir = tempfile.TemporaryDirectory()
        path = f"{self._tmpdir.name}/demo.db"
        conn = sqlite3.connect(path)
        conn.execute("CREATE TABLE orders (id INTEGER PRIMARY KEY, amount REAL)")
        conn.executemany("INSERT INTO orders (amount) VALUES (?)", [(10.0,), (20.0,)])
        conn.commit()
        conn.close()
        self.connection = {
            "db_type": "sqlite",
            "config": {"path": path},
        }

    def tearDown(self) -> None:
        self._tmpdir.cleanup()

    def test_query_and_list_tables(self) -> None:
        tables = list_tables(self.connection)
        self.assertIn("orders", tables)
        result = run_query(self.connection, "SELECT COUNT(*) AS c FROM orders LIMIT 10")
        self.assertEqual(result["rows"][0]["c"], 2)


if __name__ == "__main__":
    unittest.main()
