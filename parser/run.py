"""Full pipeline: instrument → compile → run → normalize.

Usage:
    python run.py <source_file>
    python run.py <source_file> -o output.json
"""

import argparse
import json
import os
import subprocess
import sys

from tree_sitter import Parser

from normalize import fill_json, stdin_to_json
from tracer import languages as _languages  # noqa: F401
from tracer.registry import get_language


def _make_error(stage, message, metadata=None, traces=None):
    return {
        "success": False,
        "error": {"stage": stage, "message": message},
        "metadata": metadata or {},
        "traces": traces or [],
    }


def _derived_paths(input_file):
    """Build output paths next to the input file."""
    abs_input = os.path.abspath(input_file)
    directory = os.path.dirname(abs_input)
    basename = os.path.basename(abs_input)
    stem, ext = os.path.splitext(basename)
    return {
        "instrumented": os.path.join(directory, f"instrumented_{basename}"),
        "trace": os.path.join(directory, f"{stem}_trace.txt"),
        "exe": os.path.join(directory, f"{stem}.exe"),
        "ext": ext,
    }


def _instrument(input_file):
    ext = os.path.splitext(input_file)[1]
    lang = get_language(ext)
    if not lang:
        raise ValueError(f"Unsupported extension '{ext}'")

    with open(input_file, "rb") as f:
        code_bytes = f.read()

    ts_parser = Parser()
    ts_parser.language = lang.get_ts_language()

    symbol_table = lang.analyze_types(ts_parser, code_bytes)
    metadata = lang.collect_metadata(ts_parser, code_bytes, input_file)
    code = lang.instrument(ts_parser, code_bytes, symbol_table, metadata)
    return code, ext


def _compile(src_path, exe_path):
    proc = subprocess.run(
        ["gcc", src_path, "-o", exe_path],
        capture_output=True,
        text=True,
        timeout=30,
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip())
    return exe_path


def _run(cmd, timeout=30):
    proc = subprocess.run(cmd, capture_output=True, timeout=timeout)
    stdout = proc.stdout.decode("utf-8", errors="replace").replace("\r\n", "\n")
    stderr = proc.stderr.decode("utf-8", errors="replace").strip()
    return proc.returncode, stdout, stderr


def _normalize(raw_output, seed):
    if not raw_output.strip():
        return {}, []
    result = json.loads(fill_json(stdin_to_json(raw_output), seed))
    return result.get("metadata", {}), result.get("traces", []), result.get("seed", -1)


def deal(input, output=None, seed=None):
    paths = _derived_paths(input)

    # ── Instrument ──────────────────────────────────────────────
    try:
        code, ext = _instrument(input)
    except Exception as e:
        result = _make_error("instrument", str(e))
        _emit(result, output)
        return 1

    with open(paths["instrumented"], "w") as f:
        f.write(code)

    # ── Compile / Run ───────────────────────────────────────────
    is_python = ext == ".py"

    if is_python:
        cmd = [sys.executable, paths["instrumented"]]
    else:
        try:
            _compile(paths["instrumented"], paths["exe"])
        except subprocess.TimeoutExpired:
            result = _make_error("compile", "Compilation timed out")
            _emit(result, output)
            return 1
        except RuntimeError as e:
            result = _make_error("compile", str(e))
            _emit(result, output)
            return 1
        cmd = [paths["exe"]]

    try:
        rc, stdout, stderr = _run(cmd)
    except subprocess.TimeoutExpired:
        result = _make_error("runtime", "Program timed out (30s limit)")
        _emit(result, output)
        return 1

    # Save raw trace output
    with open(paths["trace"], "w") as f:
        f.write(stdout)

    # ── Normalize ───────────────────────────────────────────────
    try:
        metadata, traces, seed = _normalize(stdout, seed)
    except Exception as e:
        result = _make_error("normalize", f"Failed to parse trace output: {e}")
        _emit(result, output)
        return 1

    if stderr:
        result = _make_error(
            "runtime",
            stderr,
            metadata=metadata,
            traces=traces,
        )
        _emit(result, output)
        return 1

    result = {"success": True, "metadata": metadata, "traces": traces, "seed": seed}
    _emit(result, output)
    return 0


def main():
    ap = argparse.ArgumentParser(description="Instrument, compile, run, and normalize.")
    ap.add_argument("input_file", help="Source file (.c or .py)")
    ap.add_argument("-o", "--output", help="Output JSON path (default: stdout)")
    ap.add_argument(
        "-s",
        "--seed",
        help="Specify a seed for randomization (optional) [Cannot run with -r]",
        type=str,
    )
    ap.add_argument(
        "-r",
        "--random",
        help="Overrides the set seed (optional) [Cannot run with -s]",
        type=bool,
        nargs="?",
        const=True,
        default=False,
    )
    args = ap.parse_args()
    if not args.output:
        args.output = ""

    if not os.path.exists(args.input_file):
        result = _make_error("input", f"File not found: {args.input_file}")
        _emit(result, args.output)
        return 1
    if args.seed and args.random:
        print("Error: Cannot use both -s/--seed and -r/--random options together.")
        return 1

    seed = None
    existing_data = None

    if args.seed is not None:
        if not (len(args.seed) >= 19 and len(args.seed) <= 20):
            print(
                f"Error: Invalid seed value of {len(args.seed)}. Seeds are 19 or 20 characters long."
            )
            sys.exit(1)
        if not args.seed.isdigit():
            print("Error: Seed must be a numeric string of 19 or 20 characters.")
            sys.exit(1)
        seed = int(args.seed)
    else:
        if os.path.exists(args.output) and not args.random:
            with open(args.output, "r") as f:
                existing_data = json.load(f)
            seed = existing_data.get("seed", None)
        else:
            seed = -1
    return deal(args.input_file, args.output, seed)


def _emit(data, output_path):
    text = json.dumps(data, indent=2)
    if output_path:
        with open(output_path, "w") as f:
            f.write(text)
    else:
        print(text)


if __name__ == "__main__":
    sys.exit(main())
