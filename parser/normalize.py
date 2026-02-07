import json
import sys
import argparse
import os
from collections.abc import Callable


def create_type_ASSIGN(
    subject: str, value: str, address: str, line_number: int, stack_depth: int
) -> dict:
    return {
        "type": "ASSIGN",
        "subject": subject,
        "value": value,
        "address": address,
        "line_number": line_number,
        "stack_depth": stack_depth,
    }


def create_type_BRANCH(
    subtype: str, condition: str, line_number: int, stack_depth: int
) -> dict:
    return {
        "type": "BRANCH",
        "subtype": subtype,
        "condition": condition,
        "line_number": line_number,
        "stack_depth": stack_depth,
    }


def create_type_CALL(*fields):
    # fields: name [, param_val ...], stack_depth
    subject = fields[0]
    stack_depth = fields[-1]
    params = list(fields[1:-1])
    result = {"type": "CALL", "subject": subject, "stack_depth": stack_depth}
    if params:
        result["args"] = params
    return result


def create_type_CONDITION(
    subject: str, condition_result: int, line_number: int, stack_depth: int
) -> dict:
    return {
        "type": "CONDITION",
        "subject": subject,
        "condition_result": condition_result,
        "line_number": line_number,
        "stack_depth": stack_depth,
    }


def create_type_DECL(
    subject: str, value: str, address: str, line_number: int, stack_depth: int
) -> dict:
    return {
        "type": "DECL",
        "subject": subject,
        "value": value,
        "address": address,
        "line_number": line_number,
        "stack_depth": stack_depth,
    }


def create_type_LOOP(
    subtype: str,
    condition: str,
    condition_result: str,
    line_number: int,
    stack_depth: int,
) -> dict:
    result = {
        "type": "LOOP",
        "subtype": subtype,
        "line_number": line_number,
        "stack_depth": stack_depth,
    }
    if condition:
        result["condition"] = condition
    if condition_result:
        result["condition_result"] = condition_result
    return result


def create_type_READ(
    subject: str, format_spec: str, address: str, line_number: int, stack_depth: int
) -> dict:
    return {
        "type": "READ",
        "subject": subject,
        "format_spec": format_spec,
        "address": address,
        "line_number": line_number,
        "stack_depth": stack_depth,
    }


def create_type_PARAM(subject: str, value: str, line_number: int) -> dict:
    return {
        "type": "PARAM",
        "subject": subject,
        "value": value,
        "line_number": line_number,
    }


def create_type_RETURN(
    subtype: str,
    value: str,
    address: str,
    line_number: int,
    stack_depth: int,
    format_spec: str = "",
) -> dict:
    result = {
        "type": "RETURN",
        "subtype": subtype,
        "value": value,
        "line_number": line_number,
        "stack_depth": stack_depth,
    }
    if address and address != "0":
        result["address"] = address
    if format_spec:
        result["format_spec"] = format_spec
    return result


def create_type_SWITCH(
    subject: str, value: str, line_number: int, stack_depth: int
) -> dict:
    return {
        "type": "SWITCH",
        "subject": subject,
        "value": value,
        "line_number": line_number,
        "stack_depth": stack_depth,
    }


def create_type_CASE(label: str, line_number: int, stack_depth: int) -> dict:
    return {
        "type": "CASE",
        "label": label,
        "line_number": line_number,
        "stack_depth": stack_depth,
    }


def create_type_UPDATE(
    subject: str,
    operator: str,
    value: str,
    address: str,
    line_number: int,
    stack_depth: int,
) -> dict:
    return {
        "type": "UPDATE",
        "subject": subject,
        "operator": operator,
        "value": value,
        "address": address,
        "line_number": line_number,
        "stack_depth": stack_depth,
    }


def create_type_TERNARY(
    subject: str, condition_result: int, line_number: int, stack_depth: int
) -> dict:
    return {
        "type": "TERNARY",
        "subject": subject,
        "condition_result": condition_result,
        "line_number": line_number,
        "stack_depth": stack_depth,
    }


def create_type_UNKNOWN(*args) -> dict:
    return {"type": "UNKNOWN", "args": args}


def generate_seed(meta_data: dict[str, str]) -> int:
    import hashlib

    hash = hashlib.sha256()
    hash.update(json.dumps(meta_data, sort_keys=True).encode("utf-8"))
    hash.digest()
    hash_int = int.from_bytes(hash.digest(), "big")

    chunks = []
    for i in range(0, len(str(hash_int)), 20):
        chunks.append(str(hash_int)[i : i + 20])

    result = 0
    for c in chunks:
        result ^= int(c)

    if len(str(result)) > 20:
        result = int(str(result)[:20])
    if len(str(result)) < 19:
        import random
        random.seed(chunks[0])
        result = int(str(result).ljust(19, random.choice("0123456789")))

    return result


def stdin_to_json(stdin_data: str) -> dict[str, dict[str, str] | list[dict[str, any]]]:
    lines = stdin_data.strip().split("\n")
    metadata = {}
    traces = []
    trace_id = 0

    switch: dict[str, Callable] = {
        "ASSIGN": create_type_ASSIGN,
        "BRANCH": create_type_BRANCH,
        "CALL": create_type_CALL,
        "CASE": create_type_CASE,
        "CONDITION": create_type_CONDITION,
        "DECL": create_type_DECL,
        "LOOP": create_type_LOOP,
        "PARAM": create_type_PARAM,
        "READ": create_type_READ,
        "RETURN": create_type_RETURN,
        "SWITCH": create_type_SWITCH,
        "TERNARY": create_type_TERNARY,
        "UPDATE": create_type_UPDATE,
    }

    for line in lines:
        # Split by null character to get fields
        fields = line.split("\0")

        trace_type = fields[0]

        if trace_type == "META":
            # Metadata goes into the metadata section
            if len(fields) >= 3:
                metadata[fields[1]] = fields[2]
        elif trace_type in switch:
            # All other types go into traces array
            try:
                trace_obj = switch[trace_type](*fields[1:])
                trace_obj["id"] = trace_id
                traces.append(trace_obj)
                trace_id += 1
            except Exception as e:
                print(f"Error: Error processing line: {line}")
                print(f"Error: Exception: {e}")
        else:
            print(f"Error: Unknown type: {trace_type} in line: {line}")
            try:
                trace_obj = create_type_UNKNOWN(*fields)
                trace_obj["id"] = trace_id
                traces.append(trace_obj)
                trace_id += 1
            except Exception as e:
                print(f"Error: Error processing unknown type: {e}")

    # Return structure with metadata and traces
    result = {"metadata": metadata, "traces": traces}

    return result


def fill_json(stdin_json, seed: int | None = None) -> str:
    if seed == -1 or seed is None:
        stdin_json["seed"] = generate_seed(stdin_json["metadata"])
    elif seed is not None:
        stdin_json["seed"] = seed

    return json.dumps(stdin_json, indent=4)


def read_from_stdin():
    all_lines = []
    for line in sys.stdin:
        # Process each line of input as it comes
        processed_line = line.strip()
        all_lines.append(processed_line)
    return "\n".join(all_lines)


def main():
    ap = argparse.ArgumentParser(description="Instrument source code for tracing.")
    ap.add_argument("json_file", help="Path to the source file")
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

    if not args.json_file:
        print("Error: No output file specified.")
        sys.exit(1)

    if args.seed and args.random:
        print("Error: Cannot use both -s/--seed and -r/--random options together.")
        sys.exit(1)

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
        if os.path.exists(args.json_file) and not args.random:
            with open(args.json_file, "r") as f:
                existing_data = json.load(f)
            seed = existing_data.get("seed", None)
        else:
            seed = -1

    with open(args.json_file, "w") as f:
        f.write(fill_json(stdin_to_json(read_from_stdin()), seed))


if __name__ == "__main__":
    main()
