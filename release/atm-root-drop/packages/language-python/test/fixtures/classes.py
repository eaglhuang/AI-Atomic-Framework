"""Fixture: top-level classes with nested methods that must not be top-level candidates."""


class RowParser:
    def parse(self, row):
        return row.split(",")

    def parse_many(self, rows):
        return [self.parse(row) for row in rows]


class RowWriter(object):
    def write(self, rows):
        return "\n".join(",".join(row) for row in rows)
