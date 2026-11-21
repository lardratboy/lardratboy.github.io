"""npm run serve: python's http.server, plus Cache-Control: no-store.

The plain server sends Last-Modified and no Cache-Control, so a browser
caches ES modules heuristically. After step 6 added colourFieldOf to
experiments/shapes.mjs, a reload fetched the new colours.js and the stale
cached shapes.mjs, and failed with "does not provide an export named
'colourFieldOf'". With no-store every reload gets every module fresh.
"""
import http.server
import sys


class NoStore(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    http.server.ThreadingHTTPServer(('', port), NoStore).serve_forever()
