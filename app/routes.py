import json
import os
import sys
import tempfile
from pathlib import Path

from flask import Blueprint, abort, jsonify, request, send_from_directory

bp = Blueprint("main", __name__)

STATIC_DIR = Path(__file__).resolve().parent.parent / "mosiacs"
DATA_DIR = STATIC_DIR / "data"

# Make parser importable — in the Docker image it lives at /srv/parser
_parser_dir = str(Path(__file__).resolve().parent.parent / "parser")
if _parser_dir not in sys.path:
    sys.path.insert(0, _parser_dir)

ALLOWED_EXTENSIONS = {".c", ".py"}


@bp.route("/api/upload", methods=["POST"])
def upload_file():
    if "file" not in request.files:
        return jsonify({"success": False, "error": {"stage": "upload", "message": "No file provided"}}), 400

    file = request.files["file"]
    if not file.filename:
        return jsonify({"success": False, "error": {"stage": "upload", "message": "No file selected"}}), 400

    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        return jsonify({"success": False, "error": {"stage": "upload", "message": f"Unsupported file type '{ext}'. Only .c and .py files are accepted."}}), 400

    with tempfile.TemporaryDirectory() as tmpdir:
        # Save uploaded file to temp directory
        src_path = os.path.join(tmpdir, file.filename)
        file.save(src_path)

        # Output JSON path in temp directory
        stem = os.path.splitext(file.filename)[0]
        out_path = os.path.join(tmpdir, f"{stem}.json")

        # Run the full pipeline: instrument → compile → run → normalize
        from run import deal

        deal(src_path, output=out_path, seed=-1)

        # Read the result
        with open(out_path) as f:
            result = json.load(f)

    # Save a copy to DATA_DIR for the trace dropdown
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    save_name = f"{stem}.json"
    with open(DATA_DIR / save_name, "w") as f:
        json.dump(result, f, indent=2)

    return jsonify(result)


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
