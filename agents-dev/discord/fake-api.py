"""A fake Discord API for discord.py's checks: canned routes, logged requests.

Serves routes.json ({path: [status, body]}) on 127.0.0.1:8080, answers 401
to any token but "test-token", and appends each request's path and query to
/requests.log.
"""

import json
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlsplit

with open("/routes.json") as f:
    ROUTES = json.load(f)


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        with open("/requests.log", "a") as log:
            log.write(self.path + "\n")
        if self.headers.get("Authorization") != "Bot test-token":
            status, body = 401, {"message": "401: Unauthorized", "code": 0}
        else:
            status, body = ROUTES.get(urlsplit(self.path).path, [404, {"message": "Unknown", "code": 0}])
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *args):
        pass


HTTPServer(("127.0.0.1", 8080), Handler).serve_forever()
