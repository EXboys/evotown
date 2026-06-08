import unittest

from database_mcp_proxy.sql_guard import sanitize_readonly_sql


class SqlGuardTest(unittest.TestCase):
    def test_accepts_select_and_adds_limit(self) -> None:
        sql = sanitize_readonly_sql("SELECT * FROM orders")
        self.assertIn("LIMIT 1000", sql)

    def test_rejects_insert(self) -> None:
        with self.assertRaises(ValueError):
            sanitize_readonly_sql("INSERT INTO orders VALUES (1)")

    def test_rejects_multi_statement(self) -> None:
        with self.assertRaises(ValueError):
            sanitize_readonly_sql("SELECT 1; SELECT 2")


if __name__ == "__main__":
    unittest.main()
