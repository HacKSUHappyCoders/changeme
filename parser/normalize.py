import json
import sys


def create_type_ASSIGN(
    subject: str, value: str, address: str, line_number: int, stack_depth: int
):
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
):
    return {
        "type": "BRANCH",
        "subtype": subtype,
        "condition": condition,
        "line_number": line_number,
        "stack_depth": stack_depth,
    }


def create_type_CALL(
    subject: str, stack_depth: int, format_spec: str = "", args: str = ""
):
    result = {"type": "CALL", "subject": subject, "stack_depth": stack_depth}
    if format_spec:
        result["format_spec"] = format_spec
    if args:
        result["args"] = args
    return result


def create_type_CONDITION(
    subject: str, condition_result: int, line_number: int, stack_depth: int
):
    return {
        "type": "CONDITION",
        "subject": subject,
        "condition_result": condition_result,
        "line_number": line_number,
        "stack_depth": stack_depth,
    }


def create_type_DECL(
    subject: str, value: str, address: str, line_number: int, stack_depth: int
):
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
):
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
):
    return {
        "type": "READ",
        "subject": subject,
        "format_spec": format_spec,
        "address": address,
        "line_number": line_number,
        "stack_depth": stack_depth,
    }


def create_type_PARAM(subject: str, value: str, line_number: int):
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
):
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
):
    return {
        "type": "SWITCH",
        "subject": subject,
        "value": value,
        "line_number": line_number,
        "stack_depth": stack_depth,
    }


def create_type_CASE(label: str, line_number: int, stack_depth: int):
    return {
        "type": "CASE",
        "label": label,
        "line_number": line_number,
        "stack_depth": stack_depth,
    }


def create_type_UPDATE(
    subject: str, operator: str, value: str, address: str, line_number: int, stack_depth: int
):
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
):
    return {
        "type": "TERNARY",
        "subject": subject,
        "condition_result": condition_result,
        "line_number": line_number,
        "stack_depth": stack_depth,
    }


def create_type_UNKNOWN(*args):
    return {"type": "UNKNOWN", "args": args}


def stdin_to_json(stdin_data: str):
    lines = stdin_data.strip().split("\n")
    metadata = {}
    traces = []
    trace_id = 0

    switch = {
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

    return json.dumps(result, indent=4)


def read_from_stdin():
    all_lines = []
    for line in sys.stdin:
        # Process each line of input as it comes
        processed_line = line.strip()
        all_lines.append(processed_line)
    return "\n".join(all_lines)


def main():
    output_path = "json_output.json"

    with open(output_path, "w") as f:
        f.write(stdin_to_json(read_from_stdin()))


if __name__ == "__main__":
    main()
