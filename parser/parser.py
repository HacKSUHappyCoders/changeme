import argparse
import os
import stat
import sys
import time

from tree_sitter import Language, Parser
from tree_sitter_c import language

C_LANGUAGE = Language(language())

ACCEPTABLE_EXTENSIONS = {".c"}

C_KEYWORDS = {
    "printf",
    "main",
    "return",
    "if",
    "while",
    "for",
    "else",
    "switch",
    "case",
    "break",
    "continue",
    "sizeof",
    "typedef",
    "struct",
    "enum",
    "union",
    "goto",
    "do",
}

DELIM = "\\0"  # Null byte delimiter for output parsing

TYPE_FMT_MAP = {
    "int": "%d",
    "float": "%f",
    "double": "%lf",
    "char": "%c",
    "char *": "%s",
    "long": "%ld",
}


class SymbolTable:
    def __init__(self):
        self.var_types = {}

    def register(self, var_name, var_type):
        self.var_types[var_name] = var_type

    def get_type(self, var_name):
        return self.var_types.get(var_name, "int")


class Helpers:
    @staticmethod
    def get_text(node, code_bytes):
        return code_bytes[node.start_byte : node.end_byte].decode("utf-8")

    @staticmethod
    def extract_var_name(node, code_bytes):
        if node.type == "identifier":
            return Helpers.get_text(node, code_bytes)
        for child in node.children:
            res = Helpers.extract_var_name(child, code_bytes)
            if res:
                return res
        return None

    @staticmethod
    def get_type_fmt(type_name):
        for k, v in TYPE_FMT_MAP.items():
            if k in type_name:
                return v
        return "%d"

    @staticmethod
    def extract_condition(node, code_bytes):
        condition = node.child_by_field_name("condition")
        if not condition:
            return "", ""
        raw = Helpers.get_text(condition, code_bytes)
        cond_expr = raw
        if raw.startswith("(") and raw.endswith(")"):
            cond_text = raw[1:-1]
        else:
            cond_text = raw
        cond_text = cond_text.replace("%", "%%").replace('"', '\\"')
        return cond_text, cond_expr


class TypeAnalyzer:
    def __init__(self, parser, code_bytes):
        self.parser = parser
        self.code_bytes = code_bytes
        self.symbol_table = SymbolTable()

    def analyze(self):
        tree = self.parser.parse(self.code_bytes)
        self._collect_types(tree.root_node)
        return self.symbol_table

    def _collect_types(self, node):
        if node.type == "declaration":
            self._handle_declaration(node)
        elif node.type == "parameter_declaration":
            self._handle_parameter(node)
        for child in node.children:
            self._collect_types(child)

    def _handle_declaration(self, node):
        type_node = node.child_by_field_name("type")
        if not type_node:
            for child in node.children:
                if child.type.endswith("_type") or child.type in (
                    "type_identifier",
                    "primitive_type",
                ):
                    type_node = child
                    break

        curr_type = Helpers.get_text(type_node, self.code_bytes) if type_node else "int"

        for child in node.children:
            if child.type == "init_declarator":
                var_node = child.child_by_field_name("declarator")
                if var_node:
                    self.symbol_table.register(
                        Helpers.get_text(var_node, self.code_bytes), curr_type
                    )

    def _handle_parameter(self, node):
        type_node = node.child_by_field_name("type")
        curr_type = Helpers.get_text(type_node, self.code_bytes) if type_node else "int"
        var_node = node.child_by_field_name("declarator")
        if var_node:
            self.symbol_table.register(
                Helpers.get_text(var_node, self.code_bytes), curr_type
            )


class MetadataCollector:
    def __init__(self, parser, code_bytes, source_file):
        self.parser = parser
        self.code_bytes = code_bytes
        self.source_file = source_file
        self.num_functions = 0
        self.num_variables = 0
        self.num_loops = 0
        self.num_branches = 0
        self.num_returns = 0
        self.num_assignments = 0
        self.num_calls = 0
        self.num_includes = 0
        self.num_comments = 0
        self.max_depth = 0
        self.function_names = []

    def collect(self):
        code_text = self.code_bytes.decode("utf-8")
        tree = self.parser.parse(self.code_bytes)
        self._walk(tree.root_node, depth=0)
        self._count_comments(tree.root_node)

        for line in code_text.splitlines():
            if line.strip().startswith("#include"):
                self.num_includes += 1

        st = os.stat(self.source_file)
        total_lines = code_text.count("\n") + 1

        return {
            "file_name": os.path.basename(self.source_file).replace("\\", "/"),
            "file_path": os.path.abspath(self.source_file).replace("\\", "/"),
            "file_size": st.st_size,
            "file_mode": stat.filemode(st.st_mode),
            "modified": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(st.st_mtime)),
            "accessed": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(st.st_atime)),
            "created": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(st.st_ctime)),
            "language": "C",
            "total_lines": total_lines,
            "non_blank_lines": sum(1 for l in code_text.splitlines() if l.strip()),
            "num_includes": self.num_includes,
            "num_comments": self.num_comments,
            "num_functions": self.num_functions,
            "function_names": ",".join(self.function_names),
            "num_variables": self.num_variables,
            "num_assignments": self.num_assignments,
            "num_calls": self.num_calls,
            "num_returns": self.num_returns,
            "num_loops": self.num_loops,
            "num_branches": self.num_branches,
            "max_nesting_depth": self.max_depth,
        }

    def _count_comments(self, node):
        for child in node.children:
            if child.type == "comment":
                self.num_comments += 1
            self._count_comments(child)

    def _walk(self, node, depth):
        if node.type == "function_definition":
            self.num_functions += 1
            for child in node.children:
                if child.type == "function_declarator":
                    for sub in child.children:
                        if sub.type == "identifier":
                            self.function_names.append(
                                Helpers.get_text(sub, self.code_bytes)
                            )
        elif node.type == "declaration":
            for child in node.children:
                if child.type == "init_declarator":
                    self.num_variables += 1
        elif node.type == "parameter_declaration":
            self.num_variables += 1
        elif node.type in ("while_statement", "for_statement", "do_statement"):
            self.num_loops += 1
        elif node.type == "if_statement":
            self.num_branches += 1
        elif node.type == "return_statement":
            self.num_returns += 1
        elif node.type == "assignment_expression":
            self.num_assignments += 1
        elif node.type == "call_expression":
            self.num_calls += 1

        if node.type == "compound_statement":
            depth += 1
            if depth > self.max_depth:
                self.max_depth = depth

        for child in node.children:
            self._walk(child, depth)


class CodeInstrumenter:
    EXCLUDE_TYPES = {
        "declaration",
        "init_declarator",
        "function_declarator",
        "assignment_expression",
        "parameter_declaration",
        "function_definition",
    }

    def __init__(self, parser, code_bytes, symbol_table, metadata=None):
        self.parser = parser
        self.code_bytes = code_bytes
        self.symbol_table = symbol_table
        self.metadata = metadata or {}
        self.lines = code_bytes.decode("utf-8").splitlines()
        self.insertions = {}
        self.pre_insertions = {}
        self.branch_counter = 0

    def instrument(self):
        tree = self.parser.parse(self.code_bytes)
        self._traverse(tree.root_node)
        return self._build_output()

    def _add_after(self, line_idx, code):
        self.insertions.setdefault(line_idx, []).append(code)

    def _add_before(self, line_idx, code):
        self.pre_insertions.setdefault(line_idx, []).append(code)

    @staticmethod
    def _make_trace(parts):
        """Generate a printf statement that outputs fields separated by null bytes."""
        fmt_parts = []
        args = []
        for part in parts:
            if isinstance(part, tuple):
                fmt_parts.append(part[0])
                args.append(part[1])
            else:
                fmt_parts.append("%s")
                args.append(f'"{part}"')

        statements = []
        for i, (fmt, arg) in enumerate(zip(fmt_parts, args)):
            if fmt == "%s":
                statements.append(f"printf({arg})")
            else:
                statements.append(f'printf("{fmt}", {arg})')
            if i < len(fmt_parts) - 1:
                statements.append("putchar(0)")
        statements.append("putchar('\\n')")

        return "    " + "; ".join(statements) + ";"

    def _build_output(self):
        result = ["int __stack_depth = 0;"]
        for i, line in enumerate(self.lines):
            if i in self.pre_insertions:
                result.extend(self.pre_insertions[i])
            result.append(line)
            if i in self.insertions:
                result.extend(self.insertions[i])
        return "\n".join(result)

    def _traverse(self, node):
        visitor = getattr(self, f"visit_{node.type}", None)
        if visitor:
            visitor(node)
        for child in node.children:
            self._traverse(child)

    def _collect_reads(self, node):
        reads = []

        def walk(n):
            if n.type == "identifier":
                parent = n.parent
                if not parent or parent.type not in self.EXCLUDE_TYPES:
                    name = Helpers.get_text(n, self.code_bytes)
                    if name not in C_KEYWORDS:
                        reads.append(name)
            for c in n.children:
                walk(c)

        walk(node)
        return reads

    # --- visitors ---

    def visit_function_definition(self, node):
        func_name = None
        params = []

        for child in node.children:
            if child.type == "function_declarator":
                for sub in child.children:
                    if sub.type == "identifier":
                        func_name = Helpers.get_text(sub, self.code_bytes)
                    elif sub.type == "parameter_list":
                        for p in sub.children:
                            if p.type == "parameter_declaration":
                                p_name = Helpers.extract_var_name(p, self.code_bytes)
                                if p_name:
                                    params.append(p_name)

        if not func_name:
            return

        body = node.child_by_field_name("body")
        if not body:
            return

        start_line = body.start_point[0]

        if func_name == "main" and self.metadata:
            for key, val in self.metadata.items():
                trace = self._make_trace(["META", str(key), str(val)])
                self._add_after(start_line, trace)

        self._add_after(start_line, "    __stack_depth++;")

        # Build CALL trace
        parts = ["CALL", func_name]
        if params:
            for p in params:
                parts.append((Helpers.get_type_fmt(self.symbol_table.get_type(p)), p))
        parts.append(("%d", "__stack_depth"))

        trace = self._make_trace(parts)
        self._add_after(start_line, trace)

    def visit_parameter_declaration(self, node):
        var_name = Helpers.extract_var_name(node, self.code_bytes)
        if var_name:
            line = node.start_point[0]
            trace = self._make_trace(
                ["PARAM", var_name, ("%d", var_name), str(line + 1)]
            )
            self._add_after(line, trace)

    def visit_if_statement(self, node):
        self.branch_counter += 1
        cond_text, cond_expr = Helpers.extract_condition(node, self.code_bytes)

        if cond_expr:
            if_line = node.start_point[0]
            trace = self._make_trace(
                [
                    "CONDITION",
                    cond_text,
                    ("%d", cond_expr),
                    str(if_line + 1),
                    ("%d", "__stack_depth"),
                ]
            )
            self._add_before(if_line, trace)

        consequence = node.child_by_field_name("consequence")
        if consequence:
            line = consequence.start_point[0]
            trace = self._make_trace(
                ["BRANCH", "if", cond_text, str(line + 1), ("%d", "__stack_depth")]
            )
            if consequence.type == "compound_statement":
                self._add_after(line, trace)
            else:
                self._add_before(line, trace)

        alternative = node.child_by_field_name("alternative")
        if alternative:
            alt_body = alternative
            if alternative.type == "else_clause":
                for child in alternative.children:
                    if child.is_named:
                        alt_body = child
                        break

            trace = self._make_trace(
                ["BRANCH", "else", cond_text, str(line + 1), ("%d", "__stack_depth")]
            )
            if alt_body.type == "compound_statement":
                line = alt_body.start_point[0]
                self._add_after(line, trace)
            elif alt_body.type != "if_statement":
                line = alt_body.start_point[0]
                self._add_before(line, trace)

    def visit_while_statement(self, node):
        cond_text, cond_expr = Helpers.extract_condition(node, self.code_bytes)
        body = node.child_by_field_name("body")
        if not body or body.type != "compound_statement":
            return
        line = body.start_point[0]
        if cond_expr:
            trace = self._make_trace(
                [
                    "LOOP",
                    "while",
                    cond_text,
                    ("%d", cond_expr),
                    str(line + 1),
                    ("%d", "__stack_depth"),
                ]
            )
        else:
            trace = self._make_trace(
                ["LOOP", "while", "", "1", str(line + 1), ("%d", "__stack_depth")]
            )
        self._add_after(line, trace)

    def visit_for_statement(self, node):
        cond_text, cond_expr = Helpers.extract_condition(node, self.code_bytes)
        body = node.child_by_field_name("body")
        if not body or body.type != "compound_statement":
            return
        line = body.start_point[0]
        if cond_expr:
            trace = self._make_trace(
                [
                    "LOOP",
                    "for",
                    cond_text,
                    ("%d", cond_expr),
                    str(line + 1),
                    ("%d", "__stack_depth"),
                ]
            )
        else:
            trace = self._make_trace(
                ["LOOP", "for", "", "1", str(line + 1), ("%d", "__stack_depth")]
            )
        self._add_after(line, trace)

    def visit_declaration(self, node):
        for child in node.children:
            if child.type == "init_declarator":
                var_name = Helpers.extract_var_name(child, self.code_bytes)
                if not var_name:
                    continue
                line = node.start_point[0]
                v_type = self.symbol_table.get_type(var_name)
                fmt = Helpers.get_type_fmt(v_type)

                trace = self._make_trace(
                    [
                        "DECL",
                        var_name,
                        (fmt, var_name),
                        ("%p", f"&{var_name}"),
                        str(line + 1),
                        ("%d", "__stack_depth"),
                    ]
                )
                self._add_after(line, trace)

                for read_var in self._collect_reads(child):
                    r_fmt = Helpers.get_type_fmt(self.symbol_table.get_type(read_var))
                    trace = self._make_trace(
                        [
                            "READ",
                            read_var,
                            (r_fmt, read_var),
                            ("%p", f"&{read_var}"),
                            str(line + 1),
                            ("%d", "__stack_depth"),
                        ]
                    )
                    self._add_before(line, trace)

    def visit_assignment_expression(self, node):
        left_var = None
        for child in node.children:
            if child.type == "identifier":
                left_var = Helpers.get_text(child, self.code_bytes)
                break

        if not left_var:
            return

        line = node.start_point[0]
        fmt = Helpers.get_type_fmt(self.symbol_table.get_type(left_var))

        trace = self._make_trace(
            [
                "ASSIGN",
                left_var,
                (fmt, left_var),
                ("%p", f"&{left_var}"),
                str(line + 1),
                ("%d", "__stack_depth"),
            ]
        )
        self._add_after(line, trace)

        for read_var in self._collect_reads(node):
            if read_var != left_var:
                r_fmt = Helpers.get_type_fmt(self.symbol_table.get_type(read_var))
                trace = self._make_trace(
                    [
                        "READ",
                        read_var,
                        (r_fmt, read_var),
                        ("%p", f"&{read_var}"),
                        str(line + 1),
                        ("%d", "__stack_depth"),
                    ]
                )
                self._add_before(line, trace)

    def visit_return_statement(self, node):
        line = node.start_point[0]
        for child in node.children:
            if child.type == "identifier":
                var_name = Helpers.get_text(child, self.code_bytes)
                if var_name not in C_KEYWORDS:
                    fmt = Helpers.get_type_fmt(self.symbol_table.get_type(var_name))
                    trace = self._make_trace(
                        [
                            "RETURN",
                            var_name,
                            (fmt, var_name),
                            ("%p", f"&{var_name}"),
                            str(line + 1),
                            ("%d", "__stack_depth"),
                        ]
                    )
                    self._add_before(line, trace)
            elif child.type in ("number_literal", "string_literal"):
                val = Helpers.get_text(child, self.code_bytes)
                trace = self._make_trace(
                    [
                        "RETURN",
                        "literal",
                        val,
                        "0",
                        str(line + 1),
                        ("%d", "__stack_depth"),
                    ]
                )
                self._add_before(line, trace)
        self._add_before(line, "    __stack_depth--;")


def main():
    parser = argparse.ArgumentParser(description="Instrument C code for tracing.")
    parser.add_argument("input_file", help="Path to the C source file")
    parser.add_argument("-o", "--output", help="Path to the output file")
    args = parser.parse_args()

    if not os.path.exists(args.input_file):
        print(f"Error: File '{args.input_file}' not found.")
        sys.exit(1)

    ext = os.path.splitext(args.input_file)[1]
    if ext not in ACCEPTABLE_EXTENSIONS:
        print(
            f"Error: File '{args.input_file}' must have an acceptable extension ({ACCEPTABLE_EXTENSIONS})"
        )
        sys.exit(1)

    with open(args.input_file, "rb") as f:
        code_bytes = f.read()

    ts_parser = Parser()
    ts_parser.language = C_LANGUAGE

    symbol_table = TypeAnalyzer(ts_parser, code_bytes).analyze()
    metadata = MetadataCollector(ts_parser, code_bytes, args.input_file).collect()

    instrumenter = CodeInstrumenter(ts_parser, code_bytes, symbol_table, metadata)
    result_code = instrumenter.instrument()

    output_path = args.output or "instrumented_" + os.path.basename(args.input_file)
    with open(output_path, "w") as f:
        f.write(result_code)

    print(f"Instrumented code written to {output_path}")


if __name__ == "__main__":
    main()
