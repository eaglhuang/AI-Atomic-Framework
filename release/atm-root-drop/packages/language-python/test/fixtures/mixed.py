"""Fixture: mixed module with constants, a class, functions, and a guard."""

DEFAULT_LIMIT = 25


class Repository:
    def fetch(self, limit=DEFAULT_LIMIT):
        return list(range(limit))


def summarize(values):
    return sum(values)


def report(values):
    return f"total={summarize(values)}"


if __name__ == "__main__":
    print(report(Repository().fetch()))
