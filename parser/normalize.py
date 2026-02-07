import argparse
import sys
import json

def create_type_ASSIGN(subject: str, value: str, address: str, line_number: int):
    return {
        "type": "ASSIGN",
        "subject": subject,
        "value": value,
        "address": address,
        "line_number": line_number
    }
def create_type_BRANCH(subtype: str, condition: str, line_number: int):
    return {
        "type": "BRANCH",
        "subtype": subtype,
        "condition": condition,
        "line_number": line_number
    }
def create_type_CALL(subject: str, format_spec: str = "", args: str = ""):
    result = {
        "type": "CALL",
        "subject": subject
    }
    if format_spec:
        result["format_spec"] = format_spec
    if args:
        result["args"] = args
    return result
def create_type_CONDITION(subject: str, condition_result: int, line_number: int):
    return {
        "type": "CONDITION",
        "subject": subject,
        "condition_result": condition_result,
        "line_number": line_number
    }
def create_type_DECL(subject: str, value: str, address: str, line_number: int):
    return {
        "type": "DECL",
        "subject": subject,
        "value": value,
        "address": address,
        "line_number": line_number
    }
def create_type_LOOP(subtype: str, condition: str = "", condition_result: int = None, line_number: int = 0):
    result = {
        "type": "LOOP",
        "subtype": subtype,
        "line_number": line_number
    }
    if condition:
        result["condition"] = condition
    if condition_result is not None:
        result["condition_result"] = condition_result
    return result
def create_type_META(key: str, value: str):
    return {
        "type": "META",
        "key": key,
        "value": value
    }
def create_type_PARAM(subject: str, value: str, line_number: int):
    return {
        "type": "PARAM",
        "subject": subject,
        "value": value,
        "line_number": line_number
    }
def create_type_READ(subject: str, format_spec: str, address: str, line_number: int):
    return {
        "type": "READ",
        "subject": subject,
        "format_spec": format_spec,
        "address": address,
        "line_number": line_number
    }
def create_type_RETURN(subtype: str, value: str, address: str = "", format_spec: str = "", line_number: int = 0):
    result = {
        "type": "RETURN",
        "subtype": subtype,
        "value": value,
        "line_number": line_number
    }
    if address:
        result["address"] = address
    if format_spec:
        result["format_spec"] = format_spec
    return result


def stdin_to_json(stdin_data: str):
    lines = stdin_data.strip().split('\n')
    results = []
    
    for line in lines:
        # Split by null character to get fields
        fields = line.split('\0')
        print(f"Fields: {fields}")
        results.append(fields)
    
    return json.dumps(results, indent=4)

def read_from_stdin():
    print("Reading input from stdin...")
    all_lines = []
    for line in sys.stdin:
        # Process each line of input as it comes
        processed_line = line.strip()
        print(f"Processed line: {processed_line}")
        all_lines.append(processed_line)
    print("Finished reading input.")
    return '\n'.join(all_lines)

def main():    
    output_path = "json_output.json"

    with open(output_path, "w") as f:
        f.write(stdin_to_json(read_from_stdin()))

if __name__ == "__main__":
    main()
