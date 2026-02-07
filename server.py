"""
Flask server for Code Mosaic Visualizer.

Serves the front-end static files and exposes a small API so the
browser can read JSON trace data at runtime.

Usage:
    pip install flask
    python server.py

Then open http://localhost:5000 in your browser.
"""

import os
import json
from flask import Flask, send_from_directory, jsonify, abort

app = Flask(__name__)

# ── paths ────────────────────────────────────────────────────────────
BASE_DIR   = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "mosiacs")
DATA_DIR   = os.path.join(STATIC_DIR, "data")


# ── API: serve trace JSON files ──────────────────────────────────────

@app.route("/api/trace")
@app.route("/api/trace/<filename>")
def get_trace(filename="test_data.json"):
    """Return a JSON trace file from the data/ folder.

    GET /api/trace              → returns data/test_data.json
    GET /api/trace/foo.json     → returns data/foo.json
    """
    # Basic safety – only allow .json files, no path traversal
    if not filename.endswith(".json") or "/" in filename or "\\" in filename:
        abort(400, description="Invalid filename")

    filepath = os.path.join(DATA_DIR, filename)
    if not os.path.isfile(filepath):
        abort(404, description=f"{filename} not found in data/")

    with open(filepath, "r") as f:
        data = json.load(f)

    return jsonify(data)


@app.route("/api/traces")
def list_traces():
    """List all available .json trace files in data/."""
    if not os.path.isdir(DATA_DIR):
        return jsonify([])
    files = [f for f in os.listdir(DATA_DIR) if f.endswith(".json")]
    files.sort()
    return jsonify(files)


# ── Static files: serve the front-end ────────────────────────────────

@app.route("/")
def index():
    return send_from_directory(STATIC_DIR, "index.html")


@app.route("/<path:path>")
def static_files(path):
    return send_from_directory(STATIC_DIR, path)


# ── Run ──────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("🎨  Code Mosaic server running at http://localhost:5000")
    app.run(debug=True, port=5000)
