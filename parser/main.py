import argparse
import os
import sys

from tree_sitter import Language, Parser
from tree_sitter_c import language

C_LANGUAGE = Language(language())


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
        mapping = {
            "int": "%d",
            "float": "%f",
            "double": "%lf",
            "char": "%c",
            "char *": "%s",
            "long": "%ld",
        }
        for k, v in mapping.items():
            if k in type_name:
                return v
        return "%d"


class TypeAnalyzer:
    def __init__(self, parser, code_bytes):
        self.parser = parser
        self.code_bytes = code_bytes
        self.symbol_table = SymbolTable()

    def analyze(self, node=None):
        if node is None:
            tree = self.parser.parse(self.code_bytes)
            node = tree.root_node
        self._collect_types(node)
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
                if child.type.endswith("_type") or child.type in [
                    "type_identifier",
                    "primitive_type",
                ]:
                    type_node = child
                    break

        curr_type = "int"
        if type_node:
            curr_type = Helpers.get_text(type_node, self.code_bytes)

        for child in node.children:
            if child.type == "init_declarator":
                var_node = child.child_by_field_name("declarator")
                if var_node:
                    var_name = Helpers.get_text(var_node, self.code_bytes)
                    self.symbol_table.register(var_name, curr_type)

    def _handle_parameter(self, node):
        type_node = node.child_by_field_name("type")
        curr_type = "int"
        if type_node:
            curr_type = Helpers.get_text(type_node, self.code_bytes)

        var_node = node.child_by_field_name("declarator")
        if var_node:
            var_name = Helpers.get_text(var_node, self.code_bytes)
            self.symbol_table.register(var_name, curr_type)


class CodeInstrumenter:
    def __init__(self, parser, code_bytes, symbol_table):
        self.parser = parser
        self.code_bytes = code_bytes
        self.symbol_table = symbol_table
        self.lines = code_bytes.decode("utf-8").splitlines()
        self.insertions = {}
        self.pre_insertions = {}

        self.branch_counter = 0

        self.exclude_types = {
            "declaration",
            "init_declarator",
            "function_declarator",
            "assignment_expression",
            "parameter_declaration",
            "function_definition",
        }

    def instrument(self):
        tree = self.parser.parse(self.code_bytes)
        self._traverse(tree.root_node)
        return self._build_output()

    def _add_after(self, line_idx, code):
        self.insertions.setdefault(line_idx, []).append(code)

    def _add_before(self, line_idx, code):
        self.pre_insertions.setdefault(line_idx, []).append(code)

    def _build_output(self):
        result = []
        result.append("int __stack_depth = 0;")

        for i, line in enumerate(self.lines):
            if i in self.pre_insertions:
                result.extend(self.pre_insertions[i])
            result.append(line)
            if i in self.insertions:
                result.extend(self.insertions[i])

        return "\n".join(result)

    def _traverse(self, node):
        method_name = f"visit_{node.type}"
        if hasattr(self, method_name):
            getattr(self, method_name)(node)

        for child in node.children:
            self._traverse(child)

    def _collect_reads(self, node):
        reads = []

        def walk(n):
            if n.type == "identifier":
                parent = n.parent
                if not parent or parent.type not in self.exclude_types:
                    name = Helpers.get_text(n, self.code_bytes)
                    if name not in [
                        "printf",
                        "add",
                        "main",
                        "return",
                        "if",
                        "while",
                        "for",
                        "else",
                    ]:
                        reads.append(name)
            for c in n.children:
                walk(c)

        walk(node)
        return reads

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

        if func_name:
            body = node.child_by_field_name("body")
            if body:
                start_line = body.start_point[0]
                self._add_after(start_line, "    __stack_depth++;")

                fmt_params = []
                args_params = []
                for p in params:
                    p_type = self.symbol_table.get_type(p)
                    fmt_params.append(Helpers.get_type_fmt(p_type))
                    args_params.append(p)

                fmt_part = ",".join(fmt_params)
                args_part = ",".join(args_params)

                if args_part:
                    trace = f'    printf("CALL|{func_name}|{fmt_part}|{args_part}|%d\\n", {args_part}, __stack_depth);'
                else:
                    trace = f'    printf("CALL|{func_name}|||%d\\n", __stack_depth);'

                self._add_after(start_line, trace)

    def visit_parameter_declaration(self, node):
        var_name = Helpers.extract_var_name(node, self.code_bytes)
        if var_name:
            line = node.start_point[0]
            self._add_after(
                line, f'    printf("PARAM|{var_name}|%d|{line + 1}\\n", {var_name});'
            )

    def visit_if_statement(self, node):
        self.branch_counter += 1

        # Extract condition: raw expr for evaluation, sanitized text for display
        condition = node.child_by_field_name("condition")
        cond_text = ""
        cond_expr = ""
        if condition:
            raw = Helpers.get_text(condition, self.code_bytes)
            cond_expr = raw  # keep parens for C evaluation
            if raw.startswith("(") and raw.endswith(")"):
                cond_text = raw[1:-1]
            else:
                cond_text = raw
            cond_text = cond_text.replace("%", "%%").replace('"', '\\"')

        # Emit condition evaluation before the if statement
        if_line = node.start_point[0]
        if cond_expr:
            self._add_before(
                if_line,
                f'    printf("CONDITION|{cond_text}|%d|{if_line + 1}|%d\\n", {cond_expr}, __stack_depth);',
            )

        # Track if branch taken
        consequence = node.child_by_field_name("consequence")
        if consequence:
            if consequence.type == "compound_statement":
                line = consequence.start_point[0]
                self._add_after(
                    line,
                    f'    printf("BRANCH|if|{cond_text}|{line + 1}|%d\\n", __stack_depth);',
                )
            else:
                # Single statement without braces
                line = consequence.start_point[0]
                self._add_before(
                    line,
                    f'    printf("BRANCH|if|{cond_text}|{line + 1}|%d\\n", __stack_depth);',
                )

        # Track else branch taken
        alternative = node.child_by_field_name("alternative")
        if alternative:
            # tree-sitter-c wraps else in an else_clause node
            alt_body = alternative
            if alternative.type == "else_clause":
                for child in alternative.children:
                    if child.is_named:
                        alt_body = child
                        break

            if alt_body.type == "compound_statement":
                line = alt_body.start_point[0]
                self._add_after(
                    line,
                    f'    printf("BRANCH|else|{cond_text}|{line + 1}|%d\\n", __stack_depth);',
                )
            elif alt_body.type != "if_statement":
                # Single statement else (no braces, not else-if)
                line = alt_body.start_point[0]
                self._add_before(
                    line,
                    f'    printf("BRANCH|else|{cond_text}|{line + 1}|%d\\n", __stack_depth);',
                )
            # else-if chains are handled by recursive traversal

    def visit_while_statement(self, node):
        self._handle_loop(node)

    def visit_for_statement(self, node):
        self._handle_loop(node)

    def _handle_loop(self, node):
        body = node.child_by_field_name("body")
        if body and body.type == "compound_statement":
            line = body.start_point[0]
            self._add_after(
                line, f'    printf("LOOP|iter|{line + 1}|%d\\n", __stack_depth);'
            )

    def visit_declaration(self, node):
        for child in node.children:
            if child.type == "init_declarator":
                var_name = Helpers.extract_var_name(child, self.code_bytes)
                if var_name:
                    line = node.start_point[0]
                    v_type = self.symbol_table.get_type(var_name)
                    fmt = Helpers.get_type_fmt(v_type)

                    self._add_after(
                        line,
                        f'    printf("DECL|{var_name}|{fmt}|%p|{line + 1}|%d\\n", {var_name}, &{var_name}, __stack_depth);',
                    )

                    reads = self._collect_reads(child)
                    for read_var in reads:
                        r_type = self.symbol_table.get_type(read_var)
                        r_fmt = Helpers.get_type_fmt(r_type)
                        self._add_before(
                            line,
                            f'    printf("READ|{read_var}|{r_fmt}|%p|{line + 1}|%d\\n", {read_var}, &{read_var}, __stack_depth);',
                        )

    def visit_assignment_expression(self, node):
        left_var = None
        for child in node.children:
            if child.type == "identifier":
                left_var = Helpers.get_text(child, self.code_bytes)
                break

        if left_var:
            line = node.start_point[0]
            v_type = self.symbol_table.get_type(left_var)
            fmt = Helpers.get_type_fmt(v_type)

            self._add_after(
                line,
                f'    printf("ASSIGN|{left_var}|{fmt}|%p|{line + 1}|%d\\n", {left_var}, &{left_var}, __stack_depth);',
            )

            reads = self._collect_reads(node)
            for read_var in reads:
                if read_var != left_var:
                    r_type = self.symbol_table.get_type(read_var)
                    r_fmt = Helpers.get_type_fmt(r_type)
                    self._add_before(
                        line,
                        f'    printf("READ|{read_var}|{r_fmt}|%p|{line + 1}|%d\\n", {read_var}, &{read_var}, __stack_depth);',
                    )

    def visit_return_statement(self, node):
        line = node.start_point[0]
        for child in node.children:
            if child.type == "identifier":
                var_name = Helpers.get_text(child, self.code_bytes)
                if var_name != "printf":
                    v_type = self.symbol_table.get_type(var_name)
                    fmt = Helpers.get_type_fmt(v_type)
                    self._add_before(
                        line,
                        f'    printf("RETURN|{var_name}|{fmt}|%p|{line + 1}|%d\\n", {var_name}, &{var_name}, __stack_depth);',
                    )
            elif child.type in ["number_literal", "string_literal"]:
                val = Helpers.get_text(child, self.code_bytes)
                self._add_before(
                    line,
                    f'    printf("RETURN|literal|{val}|0|{line + 1}|%d\\n", __stack_depth);',
                )

        self._add_before(line, "    __stack_depth--;")


def main():
    parser = argparse.ArgumentParser(description="Instrument C code for tracing.")
    parser.add_argument("input_file", help="Path to the C source file")
    parser.add_argument("-o", "--output", help="Path to the output file")
    args = parser.parse_args()

    if not os.path.exists(args.input_file):
        print(f"Error: File '{args.input_file}' not found.")
        sys.exit(1)

    pot = args.input_file.split(".")
    if len(pot) < 2:
        print(f"Error: File {args.input_file} must have valid file extension")
        sys.exit(1)

    acceptable_extensions = ["c"]
    if pot[-1] not in acceptable_extensions:
        print(
            f"Error: File {args.input_file} must have acceptable file extension ({acceptable_extensions})"
        )
        sys.exit(1)

    with open(args.input_file, "rb") as f:
        code_bytes = f.read()

    ts_parser = Parser()
    ts_parser.language = C_LANGUAGE

    analyzer = TypeAnalyzer(ts_parser, code_bytes)
    symbol_table = analyzer.analyze()

    instrumenter = CodeInstrumenter(ts_parser, code_bytes, symbol_table)
    result_code = instrumenter.instrument()

    output_path = (
        args.output
        if args.output
        else "instrumented_" + os.path.basename(args.input_file)
    )
    with open(output_path, "w") as f:
        f.write(result_code)

    print(f"Instrumented code written to {output_path}")


if __name__ == "__main__":
    main()
