import json
from pathlib import Path

from flask import Blueprint, abort, jsonify, send_from_directory

bp = Blueprint("main", __name__)

STATIC_DIR = Path(__file__).resolve().parent.parent / "mosiacs"
DATA_DIR = STATIC_DIR / "data"


@bp.route("/api/trace")
@bp.route("/api/trace/<filename>")
def get_trace(filename="test_data.json"):
    if not filename.endswith(".json") or "/" in filename or "\\" in filename:
        abort(400, description="Invalid filename")

    filepath = DATA_DIR / filename
    if not filepath.is_file():
        abort(404, description=f"{filename} not found in data/")

    with open(filepath) as f:
        data = json.load(f)

    return jsonify(data)


@bp.route("/api/traces")
def list_traces():
    if not DATA_DIR.is_dir():
        return jsonify([])
    files = sorted(p.name for p in DATA_DIR.glob("*.json"))
    return jsonify(files)


@bp.route("/")
def index():
    return send_from_directory(STATIC_DIR, "index.html")


@bp.route("/<path:path>")
def static_files(path):
    return send_from_directory(STATIC_DIR, path)
