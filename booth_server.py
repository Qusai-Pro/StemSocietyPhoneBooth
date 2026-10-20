#!/usr/bin/env python3
"""STEM Society Meme Booth: local server for the booth PC.

    python3 booth_server.py            # then open http://localhost:8000 on the booth PC

It does what `python3 -m http.server` does (serves this folder, which the
camera page needs) plus:

  POST /api/upload   the page sends the finished strip here; it's saved in gallery/
  GET  /g/<id>       a phone-friendly "save your strip" page (what the QR opens)
  GET  /gallery      every strip taken so far (for the organisers)
  GET  /api/info     tells the page the booth PC's Wi-Fi address, for the QR code

No extra packages: standard library only. Phones must be on the same Wi-Fi as
the booth PC (a phone hotspot works fine). The booth PC itself must open the
page as http://localhost:PORT, because browsers only allow the camera there.
"""
import argparse
import html
import json
import re
import secrets
import socket
import sys
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
GALLERY = ROOT / "gallery"
MAX_UPLOAD = 15 * 1024 * 1024
ID_RE = re.compile(r"^[0-9a-f]{8}$")

CSS = """
*{box-sizing:border-box;margin:0}
body{font-family:system-ui,sans-serif;background:#1b1213;color:#fff7f4;min-height:100vh;padding:20px 14px;text-align:center}
h1{font:700 15px/1.4 'Press Start 2P',ui-monospace,monospace;color:#e5584f;margin:6px 0 4px;letter-spacing:1px}
p.sub{font-size:13px;color:#f7c9c4;margin-bottom:18px}
img.strip{display:block;margin:0 auto 18px;width:min(78vw,340px);border:4px solid #e5584f;box-shadow:6px 6px 0 #b83a35;background:#fff}
a.btn,button.btn{display:block;width:min(78vw,340px);margin:10px auto;padding:15px;background:#e5584f;color:#fff;border:3px solid #1b1213;
 box-shadow:0 5px 0 #b83a35;font:700 12px/1 'Press Start 2P',ui-monospace,monospace;text-decoration:none;cursor:pointer;letter-spacing:1px}
a.btn.alt,button.btn.alt{background:#fff7f4;color:#b83a35}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:14px;max-width:1100px;margin:0 auto}
.grid img{width:100%;border:3px solid #e5584f;background:#fff}
.grid a{color:#f7c9c4;font-size:12px;text-decoration:none}
"""

FONT = "<link rel='stylesheet' href='https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap'>"


def lan_ip():
    """The address other devices on the Wi-Fi can reach this PC on."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))   # no packet is sent; this just picks the right interface
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map,
                      ".mjs": "text/javascript", ".js": "text/javascript", ".wasm": "application/wasm"}
    public_url = ""

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(ROOT), **kw)

    # ---- helpers --------------------------------------------------------
    def send_bytes(self, code, body, ctype):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def send_json(self, obj, code=200):
        self.send_bytes(code, json.dumps(obj).encode(), "application/json")

    def send_page(self, title, body, code=200):
        page = (f"<!doctype html><html lang='en'><head><meta charset='utf-8'>"
                f"<meta name='viewport' content='width=device-width,initial-scale=1'>"
                f"<title>{html.escape(title)}</title>{FONT}<style>{CSS}</style></head><body>{body}</body></html>")
        self.send_bytes(code, page.encode(), "text/html; charset=utf-8")

    def strips(self):
        return sorted(GALLERY.glob("*.jpg"), key=lambda p: p.stat().st_mtime, reverse=True)

    # ---- routes ---------------------------------------------------------
    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path == "/api/info":
            return self.send_json({"booth": True, "lan_url": self.public_url, "count": len(self.strips())})
        m = re.fullmatch(r"/g/([0-9a-f]{8})", path)
        if m:
            return self.phone_page(m.group(1))
        if path in ("/gallery", "/gallery/"):
            return self.gallery_page()
        super().do_GET()

    def phone_page(self, sid):
        if not (GALLERY / f"{sid}.jpg").exists():
            return self.send_page("Not found", "<h1>STRIP NOT FOUND</h1><p class='sub'>Ask the booth team for help.</p>", 404)
        body = f"""
        <h1>YOUR STRIP!</h1><p class='sub'>STEM Society · Beaconhouse College Program PECHS</p>
        <img class='strip' src='/gallery/{sid}.jpg' alt='Your photo strip'>
        <a class='btn' href='/gallery/{sid}.jpg' download='stem-society-strip-{sid}.jpg'>SAVE TO PHONE</a>
        <button class='btn alt' id='share' hidden>SHARE</button>
        <p class='sub'>Tip: if Save doesn't work, press and hold the picture.</p>
        <script>
        const b=document.getElementById('share');
        if(navigator.canShare){{b.hidden=false;b.onclick=async()=>{{
          const blob=await (await fetch('/gallery/{sid}.jpg')).blob();
          const f=new File([blob],'stem-society-strip.jpg',{{type:'image/jpeg'}});
          if(navigator.canShare({{files:[f]}})) navigator.share({{files:[f],title:'My STEM Society strip'}}).catch(()=>{{}});
        }}}}
        </script>"""
        self.send_page("Your photo strip", body)

    def gallery_page(self):
        items = "".join(
            f"<div><a href='/g/{p.stem}'><img loading='lazy' src='/gallery/{p.name}'><br>"
            f"{time.strftime('%H:%M', time.localtime(p.stat().st_mtime))}</a></div>"
            for p in self.strips() if ID_RE.match(p.stem))
        self.send_page("Gallery", f"<h1>GALLERY · {len(self.strips())} STRIPS</h1><p class='sub'>Tap a strip to open its download page.</p>"
                                  f"<div class='grid'>{items}</div>")

    def do_POST(self):
        if self.path != "/api/upload":
            return self.send_json({"error": "not found"}, 404)
        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0 or n > MAX_UPLOAD:
            return self.send_json({"error": "bad size"}, 400)
        data = self.rfile.read(n)
        if data[:2] != b"\xff\xd8":   # JPEG magic number
            return self.send_json({"error": "not a JPEG"}, 400)
        GALLERY.mkdir(exist_ok=True)
        sid = secrets.token_hex(4)
        (GALLERY / f"{sid}.jpg").write_bytes(data)
        self.send_json({"id": sid, "path": f"/g/{sid}"})

    def log_message(self, fmt, *args):
        if "/api/info" not in str(args[0] if args else ""):
            super().log_message(fmt, *args)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--host", default="0.0.0.0", help="interface to listen on (default: all, so phones can connect)")
    ap.add_argument("--public-url", help="address phones should use if auto-detection picks the wrong one, e.g. http://192.168.0.12:8000")
    args = ap.parse_args()

    GALLERY.mkdir(exist_ok=True)
    Handler.public_url = (args.public_url or f"http://{lan_ip()}:{args.port}").rstrip("/")
    try:
        srv = ThreadingHTTPServer((args.host, args.port), Handler)
    except OSError as e:
        sys.exit(f"Couldn't start on port {args.port}: {e}. Try --port 8080.")
    print("STEM Society Meme Booth")
    print(f"  Booth PC opens : http://localhost:{args.port}")
    print(f"  Phones reach   : {Handler.public_url}   (same Wi-Fi as this PC; this is what the QR code points at)")
    print(f"  Strips saved in: {GALLERY}")
    print("  Organiser view : /gallery        Ctrl+C to stop")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nBye!")


if __name__ == "__main__":
    main()
