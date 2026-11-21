"""A local stand-in for Exa's search API: POST /search, in Exa's request and response shape.

It finds pages through a SearXNG instance and re-orders them by meaning: the query and each page's
title and excerpt are embedded with a small model on the CPU, and the closest pages come first.
Nothing is sent to Exa, and the pages are SearXNG's, not Exa's own index.
"""

import json
import os
import time
import urllib.parse
import urllib.request
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np
from fastembed import TextEmbedding

SEARXNG = os.environ.get("SEARXNG_URL", "http://127.0.0.1:8888").rstrip("/")
MODEL = TextEmbedding(os.environ.get("EMBED_MODEL", "BAAI/bge-small-en-v1.5"))


def on_site(url, domains):
    host = urllib.parse.urlparse(url).hostname or ""
    return any(host == domain or host.endswith("." + domain) for domain in domains)


def search(body):
    """Exa's /search for `body`: query, numResults, includeDomains, excludeDomains and contents.text."""
    query = body["query"]
    include, exclude = body.get("includeDomains") or [], body.get("excludeDomains") or []
    asked = " ".join([query, " OR ".join(f"site:{domain}" for domain in include)]).strip()
    with urllib.request.urlopen(f"{SEARXNG}/search?{urllib.parse.urlencode({'q': asked, 'format': 'json'})}", timeout=20) as reply:
        found = json.load(reply)["results"]
    pages = [page for page in found if not on_site(page["url"], exclude) and (not include or on_site(page["url"], include))]
    scores = []
    if pages:
        ask = next(iter(MODEL.query_embed(query)))
        texts = np.array(list(MODEL.embed([f"{page.get('title', '')}\n{page.get('content', '')}" for page in pages])))
        scores = texts @ ask / (np.linalg.norm(texts, axis=1) * np.linalg.norm(ask))
    wants_text = bool((body.get("contents") or {}).get("text"))
    results = [
        {
            "id": pages[i]["url"],
            "title": pages[i].get("title", ""),
            "url": pages[i]["url"],
            "publishedDate": pages[i].get("publishedDate"),
            "author": None,
            "score": round(float(scores[i]), 4),
            "highlights": [pages[i].get("content", "")],
            **({"text": pages[i].get("content", "")} if wants_text else {}),
        }
        for i in np.argsort(scores)[::-1][: int(body.get("numResults") or 10)]
    ]
    return {"requestId": uuid.uuid4().hex, "resolvedSearchType": "neural", "results": results, "costDollars": {"total": 0}}, len(found)


class Handler(BaseHTTPRequestHandler):
    def answer(self, status, reply):
        data = json.dumps(reply).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        self.answer(200, {"status": "ok", "serves": "POST /search", "searxng": SEARXNG})

    def do_POST(self):
        started = time.time()
        if self.path != "/search":
            return self.answer(404, {"error": "Only POST /search is served here."})
        try:
            body = json.loads(self.rfile.read(int(self.headers.get("content-length") or 0)))
            reply, found = search(body)
        except Exception as error:  # a bad request or SearXNG down: Exa's own error shape
            print(f"{time.strftime('%F %T')} POST /search failed: {error!r}", flush=True)
            return self.answer(400 if isinstance(error, (KeyError, ValueError)) else 502, {"error": repr(error)})
        reply["searchTime"] = round((time.time() - started) * 1000)
        print(f"{time.strftime('%F %T')} POST /search from {self.client_address[0]} query={body['query']!r} found={found} returned={len(reply['results'])} ms={reply['searchTime']}", flush=True)
        self.answer(200, reply)

    def log_message(self, *_):  # one line per search, printed above
        pass


if __name__ == "__main__":
    address = (os.environ.get("HOST", "127.0.0.1"), int(os.environ.get("PORT", "3303")))
    print(f"Local Exa stand-in on http://{address[0]}:{address[1]}, pages from {SEARXNG}", flush=True)
    ThreadingHTTPServer(address, Handler).serve_forever()
