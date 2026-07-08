#!/usr/local/bin/python3.7
import sys, os
sys.path.insert(0, os.path.dirname(__file__))

from wsgiref.handlers import CGIHandler
from app import app

CGIHandler().run(app)
