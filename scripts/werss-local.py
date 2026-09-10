"""Run upstream WeRSS locally without its main.py environment dump or public binding."""
import os
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1] / "data/services/we-mp-rss"
os.chdir(root)
sys.path.insert(0, str(root))
sys.argv = ["werss-local", "-config", "config.yaml"]
os.environ.setdefault("CHROME_EXECUTABLE_PATH", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
os.environ.setdefault("REDIS_SERVER_ENABLED", "False")
os.environ.setdefault("REDIS_URL", "")
# Prefer HTTP QR login over Playwright web auth — browser path often times out.
os.environ["WERSS_AUTH_WEB"] = "False"
os.environ.setdefault("AUTO_RELOAD", "False")
os.environ.setdefault("ENABLE_JOB", "False")
from dotenv import load_dotenv

load_dotenv(root / ".env")
from core.config import cfg
import init_sys

init_sys.init()

# apis.auth imports WX_API from driver.wx; point it at the HTTP QR implementation.
import driver.wx as wx_browser
from driver.wx_api import WeChat_api

wx_browser.WX_API = WeChat_api

import uvicorn

uvicorn.run("web:app", host="127.0.0.1", port=8001, log_level="warning")
