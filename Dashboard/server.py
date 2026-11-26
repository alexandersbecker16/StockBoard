"""StockBoard - a local live stock dashboard.

Runs a small web server on http://localhost:8050 that serves the dashboard
page and proxies quote data from Yahoo Finance's public chart API.
Uses only the Python standard library - no installs needed.

    python server.py            # then open http://localhost:8050
    python server.py --port 9000
"""

import argparse
import json
import os
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from concurrent.futures import ThreadPoolExecutor
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
STATIC = os.path.join(HERE, "static")
WATCHLIST_FILE = os.path.join(HERE, "watchlist.json")
DEFAULT_WATCHLIST = ["AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "TSLA"]

UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) StockBoard/1.0"}
YAHOO = "https://query1.finance.yahoo.com"

# Valid (range -> interval) pairs for the detail chart.
RANGES = {
    "1d": "5m",
    "5d": "15m",
    "1mo": "1d",
    "6mo": "1d",
    "1y": "1d",
    "5y": "1wk",
}

_cache = {}
_cache_lock = threading.Lock()
_file_lock = threading.Lock()


def fetch_json(url, ttl=10):
    """GET a JSON URL with a short in-memory cache to avoid hammering Yahoo."""
    now = time.time()
    with _cache_lock:
        hit = _cache.get(url)
        if hit and now - hit[0] < ttl:
            return hit[1]
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=10) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    with _cache_lock:
        _cache[url] = (now, data)
    return data


def chart(symbol, rng="1d", interval=None, ttl=10):
    interval = interval or RANGES.get(rng, "1d")
    q = urllib.parse.urlencode({"range": rng, "interval": interval, "includePrePost": "false"})
    url = f"{YAHOO}/v8/finance/chart/{urllib.parse.quote(symbol)}?{q}"
    data = fetch_json(url, ttl=ttl)
    result = (data.get("chart") or {}).get("result")
    if not result:
        err = (data.get("chart") or {}).get("error") or {}
        raise ValueError(err.get("description") or f"No data for {symbol}")
    r = result[0]
    meta = r.get("meta", {})
    ts = r.get("timestamp") or []
    closes = ((r.get("indicators") or {}).get("quote") or [{}])[0].get("close") or []
    points = [[t, c] for t, c in zip(ts, closes) if c is not None]
    return meta, points


def quote(symbol):
    meta, points = chart(symbol, "1d", "5m", ttl=10)
    price = meta.get("regularMarketPrice")
    prev = meta.get("chartPreviousClose") or meta.get("previousClose")
    change = (price - prev) if (price is not None and prev) else None
    pct = (change / prev * 100) if change is not None else None
    return {
        "symbol": meta.get("symbol", symbol),
        "name": meta.get("longName") or meta.get("shortName") or symbol,
        "exchange": meta.get("fullExchangeName") or meta.get("exchangeName"),
        "currency": meta.get("currency"),
        "price": price,
        "prevClose": prev,
        "change": change,
        "changePct": pct,
        "dayHigh": meta.get("regularMarketDayHigh"),
        "dayLow": meta.get("regularMarketDayLow"),
        "volume": meta.get("regularMarketVolume"),
        "high52": meta.get("fiftyTwoWeekHigh"),
        "low52": meta.get("fiftyTwoWeekLow"),
        "marketTime": meta.get("regularMarketTime"),
        "marketState": market_state(meta),
        "spark": points,
    }


def market_state(meta):
    period = (meta.get("currentTradingPeriod") or {}).get("regular") or {}
    now = time.time()
    start, end = period.get("start"), period.get("end")
    if start and end and start <= now <= end:
        return "open"
    return "closed"


def load_watchlist():
    with _file_lock:
        try:
            with open(WATCHLIST_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, list):
                return [str(s).upper() for s in data]
        except (OSError, ValueError):
            pass
    return list(DEFAULT_WATCHLIST)


def save_watchlist(symbols):
    clean = []
    for s in symbols:
        s = str(s).strip().upper()
        if s and s not in clean and len(s) <= 15:
            clean.append(s)
    with _file_lock:
        with open(WATCHLIST_FILE, "w", encoding="utf-8") as f:
            json.dump(clean, f, indent=2)
    return clean


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=STATIC, **kwargs)

    def log_message(self, fmt, *args):  # keep the console quiet
        pass

    def send_json(self, obj, status=200):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        url = urllib.parse.urlparse(self.path)
        qs = urllib.parse.parse_qs(url.query)
        try:
            if url.path == "/api/watchlist":
                return self.send_json(load_watchlist())
            if url.path == "/api/quotes":
                syms = [s for s in (qs.get("symbols", [""])[0]).split(",") if s]
                return self.send_json(self.quotes(syms))
            if url.path == "/api/chart":
                sym = qs.get("symbol", [""])[0]
                rng = qs.get("range", ["1d"])[0]
                if rng not in RANGES:
                    rng = "1d"
                meta, points = chart(sym, rng, ttl=10 if rng in ("1d", "5d") else 300)
                return self.send_json({
                    "symbol": sym,
                    "range": rng,
                    "prevClose": meta.get("chartPreviousClose") or meta.get("previousClose"),
                    "points": points,
                })
            if url.path == "/api/search":
                q = qs.get("q", [""])[0]
                params = urllib.parse.urlencode({"q": q, "quotesCount": 8, "newsCount": 0})
                data = fetch_json(f"{YAHOO}/v1/finance/search?{params}", ttl=60)
                out = [
                    {
                        "symbol": it.get("symbol"),
                        "name": it.get("longname") or it.get("shortname") or "",
                        "exchange": it.get("exchDisp") or "",
                        "type": it.get("typeDisp") or it.get("quoteType") or "",
                    }
                    for it in data.get("quotes", [])
                    if it.get("symbol")
                ]
                return self.send_json(out)
        except (urllib.error.URLError, ValueError, TimeoutError) as e:
            return self.send_json({"error": str(e)}, status=502)
        if url.path == "/":
            self.path = "/index.html"
        return super().do_GET()

    def do_POST(self):
        if urllib.parse.urlparse(self.path).path != "/api/watchlist":
            return self.send_json({"error": "not found"}, status=404)
        length = int(self.headers.get("Content-Length") or 0)
        try:
            symbols = json.loads(self.rfile.read(length) or b"[]")
            if not isinstance(symbols, list):
                raise ValueError("expected a list")
        except ValueError as e:
            return self.send_json({"error": str(e)}, status=400)
        return self.send_json(save_watchlist(symbols))

    @staticmethod
    def quotes(symbols):
        def one(s):
            try:
                return quote(s)
            except Exception as e:  # report per-symbol failures, don't fail the batch
                return {"symbol": s.upper(), "error": str(e)}

        with ThreadPoolExecutor(max_workers=8) as pool:
            return list(pool.map(one, symbols[:50]))


def main():
    ap = argparse.ArgumentParser(description="Local live stock dashboard")
    ap.add_argument("--port", type=int, default=8050)
    ap.add_argument("--no-browser", action="store_true", help="don't open a browser tab")
    args = ap.parse_args()

    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    url = f"http://localhost:{args.port}"
    print(f"StockBoard running at {url}  (Ctrl+C to stop)")
    if not args.no_browser:
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
