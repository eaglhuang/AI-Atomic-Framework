#!/usr/bin/env python3
import sys
from runtime import snapshot
snapshot(sys.argv[1],sys.argv[2],sys.argv[3] if len(sys.argv)>3 else None)
