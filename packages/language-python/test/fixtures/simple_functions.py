"""Fixture: plain top-level functions."""


def load_rows(source_path):
    with open(source_path, encoding="utf-8") as handle:
        return [line.strip() for line in handle if line.strip()]


def normalize_rows(rows):
    return [row.lower() for row in rows]


async def fetch_remote_rows(url):
    return [url]
