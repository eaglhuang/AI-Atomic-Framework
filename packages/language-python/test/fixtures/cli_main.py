"""Fixture: command-style script with a __main__ guard."""

import sys


def main(argv):
    print(len(argv))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
