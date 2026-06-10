"""Fixture: module with only constants and imports; no function/class/command candidates."""

import json

SETTINGS = json.loads('{"retries": 3}')
RETRY_LIMIT = SETTINGS["retries"]
