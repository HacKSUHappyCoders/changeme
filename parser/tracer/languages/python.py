import os
import stat
import time

from tree_sitter import Language
from tree_sitter_python import language

from ..base import LanguageSupport
from ..core import SymbolTable, get_text
from ..registry import register

KEYWORDS = {
    "print",
    "return",
    "if",
    "elif",
    "else",
    "while",
    "for",
    "in",
    "def",
    "class",
    "import",
    "from",
    "as",
    "with",
    "try",
    "except",
    "finally",
    "raise",
    "pass",
    "break",
    "continue",
    "and",
    "or",
    "not",
    "is",
    "None",
    "True",
    "False",
    "lambda",
    "yield",
    "global",
    "nonlocal",
    "assert",
    "del",
    "self",
    "__tracer_depth",
}


# ── Type analysis ────────────────────────────────────────────────────


class PythonTypeAnalyzer:
    """Python is dynamically typed — we just record variable names."""

    def __init__(self, ts_parser, code_bytes):
        self.ts_parser = ts_parser
        self.code_bytes = code_bytes
        self.symbol_table = SymbolTable()

    def analyze(self) -> SymbolTable:
        tree = self.ts_parser.parse(self.code_bytes)
        self._collect(tree.root_node)
        return self.symbol_table

    def _collect(self, node):
        if node.type == "assignment":
            left = node.child_by_field_name("left")
            if left and left.type == "identifier":
                name = get_text(left, self.code_bytes)
                self.symbol_table.register(name, "object")
        elif node.type == "function_definition":
            params = node.child_by_field_name("parameters")
            if params:
                for child in params.children:
                    if child.type == "identifier":
                        name = get_text(child, self.code_bytes)
                        self.symbol_table.register(name, "object")
        for child in node.children:
            self._collect(child)


# ── Metadata collection ─────────────────────────────────────────────


class PythonMetadataCollector:
    def __init__(self, ts_parser, code_bytes, source_file):
        self.ts_parser = ts_parser
        self.code_bytes = code_bytes
        self.source_file = source_file
        self.num_functions = 0
        self.num_variables = 0
        self.num_loops = 0
        self.num_branches = 0
        self.num_returns = 0
        self.num_assignments = 0
        self.num_calls = 0
        self.num_imports = 0
        self.num_comments = 0
        self.max_depth = 0
        self.function_names: list[str] = []
        self.imports: list[str] = []
        self.defined_functions: set[str] = set()

    def collect(self) -> dict:
        code_text = self.code_bytes.decode("utf-8")
        tree = self.ts_parser.parse(self.code_bytes)
        self._extract_imports(tree.root_node)
        self._walk(tree.root_node, depth=0)

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
            "language": "Python",
            "total_lines": total_lines,
            "non_blank_lines": sum(1 for ln in code_text.splitlines() if ln.strip()),
            "num_imports": self.num_imports,
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
            "imports": ",".join(self.imports),
            "defined_functions": ",".join(sorted(self.defined_functions)),
        }

    def _extract_imports(self, node):
        """Walk the AST and extract imported module names."""
        if node.type == "import_statement":
            # import module or import module as alias
            for child in node.children:
                if child.type == "dotted_name" or child.type == "identifier":
                    module_name = get_text(child, self.code_bytes)
                    self.imports.append(module_name)
        elif node.type == "import_from_statement":
            # from module import ...
            module_node = node.child_by_field_name("module_name")
            if module_node:
                module_name = get_text(module_node, self.code_bytes)
                self.imports.append(module_name)
        for child in node.children:
            self._extract_imports(child)

    def _walk(self, node, depth):
        if node.type == "function_definition":
            self.num_functions += 1
            name_node = node.child_by_field_name("name")
            if name_node:
                func_name = get_text(name_node, self.code_bytes)
                self.function_names.append(func_name)
                self.defined_functions.add(func_name)
        elif node.type == "assignment":
            self.num_variables += 1
            self.num_assignments += 1
        elif node.type == "augmented_assignment":
            self.num_assignments += 1
        elif node.type in ("while_statement", "for_statement"):
            self.num_loops += 1
        elif node.type == "if_statement":
            self.num_branches += 1
        elif node.type == "return_statement":
            self.num_returns += 1
        elif node.type == "call":
            self.num_calls += 1
        elif node.type == "comment":
            self.num_comments += 1
        elif node.type in ("import_statement", "import_from_statement"):
            self.num_imports += 1

        # Track nesting via block nodes (indented suites)
        if node.type == "block":
            depth += 1
            if depth > self.max_depth:
                self.max_depth = depth

        for child in node.children:
            self._walk(child, depth)


# ── Code instrumentation ────────────────────────────────────────────


class PythonInstrumenter:
    EXCLUDE_IDENTS = {
        "assignment",
        "augmented_assignment",
        "function_definition",
        "parameters",
    }

    def __init__(self, ts_parser, code_bytes, symbol_table, metadata=None):
        self.ts_parser = ts_parser
        self.code_bytes = code_bytes
        self.symbol_table = symbol_table
        self.metadata = metadata or {}
        self.lines = code_bytes.decode("utf-8").splitlines()
        self.insertions: dict[int, list[str]] = {}
        self.pre_insertions: dict[int, list[str]] = {}
        self.seen_vars: set[str] = set()
        # Parse defined functions from metadata
        self.defined_functions = set()
        if metadata and "defined_functions" in metadata:
            func_str = metadata["defined_functions"]
            if func_str:
                self.defined_functions = set(func_str.split(","))

    def instrument(self) -> str:
        tree = self.ts_parser.parse(self.code_bytes)
        self._traverse(tree.root_node)
        return self._build_output()

    # ── helpers ───────────────────────────────────────────────────

    def _add_after(self, line_idx, code):
        self.insertions.setdefault(line_idx, []).append(code)

    def _add_before(self, line_idx, code):
        self.pre_insertions.setdefault(line_idx, []).append(code)

    @staticmethod
    def _make_trace(parts, indent=4):
        """Build a Python print() call with null-byte separators.

        Each part is either a string literal or a tuple (expr_str,)
        representing a runtime expression to embed.
        """
        args = []
        for part in parts:
            if isinstance(part, tuple):
                # Runtime expression
                args.append(part[0])
            else:
                # String literal
                args.append(repr(part))
        prefix = " " * indent
        return f"{prefix}print({', '.join(args)}, sep='\\0')"

    def _block_indent(self, block_node):
        """Return the column indent of the first statement inside a block."""
        for child in block_node.children:
            if child.is_named:
                return child.start_point[1]
        return 4

    def _build_output(self):
        result = ["__tracer_depth = 0"]
        for i, line in enumerate(self.lines):
            if i in self.pre_insertions:
                result.extend(self.pre_insertions[i])
            result.append(line)
            if i in self.insertions:
                result.extend(self.insertions[i])
        return "\n".join(result)

    # ── AST traversal ────────────────────────────────────────────

    def _traverse(self, node):
        visitor = getattr(self, f"_visit_{node.type}", None)
        if visitor:
            visitor(node)

        # Don't recurse into elif/else from top-level — handled by _visit_if_statement
        if node.type == "if_statement":
            # Only recurse into consequence block, not alternative
            consequence = node.child_by_field_name("consequence")
            if consequence:
                for child in consequence.children:
                    self._traverse(child)
            # Handle alternative recursively via _handle_alternative
            return

        if node.type in ("elif_clause", "else_clause"):
            # These are handled by _visit_if_statement's _handle_alternative
            return

        for child in node.children:
            self._traverse(child)

    def _collect_reads(self, node):
        """Collect identifier names used in an expression (reads)."""
        reads = []

        def walk(n):
            if n.type == "identifier":
                parent = n.parent
                if not parent or parent.type not in self.EXCLUDE_IDENTS:
                    # Skip function names in call expressions
                    if (
                        parent
                        and parent.type == "call"
                        and parent.child_by_field_name("function") == n
                    ):
                        pass
                    # Skip attribute names in attribute access (e.g., 'now' in 'datetime.now')
                    elif (
                        parent
                        and parent.type == "attribute"
                        and parent.child_by_field_name("attribute") == n
                    ):
                        pass
                    # Skip keyword argument names (e.g., 'reverse' in 'sorted(..., reverse=True)')
                    elif (
                        parent
                        and parent.type == "keyword_argument"
                        and parent.child_by_field_name("name") == n
                    ):
                        pass
                    else:
                        name = get_text(n, self.code_bytes)
                        if name not in KEYWORDS:
                            reads.append(name)
            for c in n.children:
                walk(c)

        walk(node)
        return reads

    # ── visitors ─────────────────────────────────────────────────

    def _visit_function_definition(self, node):
        func_name_node = node.child_by_field_name("name")
        if not func_name_node:
            return
        func_name = get_text(func_name_node, self.code_bytes)

        params = []
        params_node = node.child_by_field_name("parameters")
        if params_node:
            for child in params_node.children:
                if child.type == "identifier":
                    params.append(get_text(child, self.code_bytes))

        body = node.child_by_field_name("body")
        if not body:
            return

        indent = self._block_indent(body)
        first_stmt = None
        for child in body.children:
            if child.is_named:
                first_stmt = child
                break

        if not first_stmt:
            return

        start_line = first_stmt.start_point[0]

        # Emit META traces if this is the entry-point function (main convention)
        if func_name == "main" and self.metadata:
            for key, val in self.metadata.items():
                trace = self._make_trace(["META", str(key), str(val)], indent)
                self._add_before(start_line, trace)

        # Depth tracking
        self._add_before(start_line, f"{' ' * indent}global __tracer_depth")
        self._add_before(start_line, f"{' ' * indent}__tracer_depth += 1")

        # CALL trace
        parts: list = ["CALL", func_name]
        for p in params:
            parts.append((p,))
        parts.append(("__tracer_depth",))
        self._add_before(start_line, self._make_trace(parts, indent))

    def _visit_assignment(self, node):
        left = node.child_by_field_name("left")
        if not left or left.type != "identifier":
            return
        var_name = get_text(left, self.code_bytes)

        line = node.start_point[0]
        col = node.start_point[1]

        # READ traces for RHS variables
        right = node.child_by_field_name("right")
        if right:
            for read_var in self._collect_reads(right):
                trace = self._make_trace(
                    [
                        "READ",
                        read_var,
                        (read_var,),
                        (f"format(id({read_var}), 'x')",),
                        str(line + 1),
                        ("__tracer_depth",),
                    ],
                    col,
                )
                self._add_before(line, trace)

        # DECL or ASSIGN
        if var_name not in self.seen_vars:
            self.seen_vars.add(var_name)
            tag = "DECL"
        else:
            tag = "ASSIGN"

        trace = self._make_trace(
            [
                tag,
                var_name,
                (var_name,),
                (f"format(id({var_name}), 'x')",),
                str(line + 1),
                ("__tracer_depth",),
            ],
            col,
        )
        self._add_after(line, trace)

    def _visit_augmented_assignment(self, node):
        left = node.child_by_field_name("left")
        if not left or left.type != "identifier":
            return
        var_name = get_text(left, self.code_bytes)

        line = node.start_point[0]
        col = node.start_point[1]

        # READ traces for RHS
        right = node.child_by_field_name("right")
        if right:
            for read_var in self._collect_reads(right):
                trace = self._make_trace(
                    [
                        "READ",
                        read_var,
                        (read_var,),
                        (f"format(id({read_var}), 'x')",),
                        str(line + 1),
                        ("__tracer_depth",),
                    ],
                    col,
                )
                self._add_before(line, trace)

        trace = self._make_trace(
            [
                "ASSIGN",
                var_name,
                (var_name,),
                (f"format(id({var_name}), 'x')",),
                str(line + 1),
                ("__tracer_depth",),
            ],
            col,
        )
        self._add_after(line, trace)

    def _visit_if_statement(self, node):
        cond_node = node.child_by_field_name("condition")
        cond_text = get_text(cond_node, self.code_bytes) if cond_node else ""
        safe_cond = cond_text.replace("'", "\\'")

        line = node.start_point[0]
        col = node.start_point[1]

        # CONDITION trace before the if
        if cond_node:
            trace = self._make_trace(
                [
                    "CONDITION",
                    safe_cond,
                    (cond_text,),
                    str(line + 1),
                    ("__tracer_depth",),
                ],
                col,
            )
            self._add_before(line, trace)

        # BRANCH trace inside the if body
        consequence = node.child_by_field_name("consequence")
        if consequence:
            indent = self._block_indent(consequence)
            first_stmt = None
            for child in consequence.children:
                if child.is_named:
                    first_stmt = child
                    break
            if first_stmt:
                trace = self._make_trace(
                    [
                        "BRANCH",
                        "if",
                        safe_cond,
                        str(first_stmt.start_point[0] + 1),
                        ("__tracer_depth",),
                    ],
                    indent,
                )
                self._add_before(first_stmt.start_point[0], trace)

        # Handle elif / else alternatives.
        # The first elif is the 'alternative' field, but else_clause may be
        # a direct child of if_statement with no field name.
        alternative = node.child_by_field_name("alternative")
        if alternative:
            self._handle_alternative(alternative, cond_text)

        # Also pick up else_clause siblings (not captured by 'alternative' field)
        for child in node.children:
            if child.type == "else_clause" and child != alternative:
                self._handle_alternative(child, cond_text)

    def _handle_alternative(self, node, parent_cond):
        """Recursively handle elif_clause and else_clause nodes."""
        safe_parent = parent_cond.replace("'", "\\'")

        if node.type == "elif_clause":
            cond_node = node.child_by_field_name("condition")
            cond_text = get_text(cond_node, self.code_bytes) if cond_node else ""
            safe_cond = cond_text.replace("'", "\\'")

            body = node.child_by_field_name("consequence")
            if body:
                indent = self._block_indent(body)
                first_stmt = None
                for child in body.children:
                    if child.is_named:
                        first_stmt = child
                        break
                if first_stmt:
                    trace = self._make_trace(
                        [
                            "BRANCH",
                            "elif",
                            safe_cond,
                            str(first_stmt.start_point[0] + 1),
                            ("__tracer_depth",),
                        ],
                        indent,
                    )
                    self._add_before(first_stmt.start_point[0], trace)

                # Recurse into the elif body for nested statements
                for child in body.children:
                    self._traverse(child)

            # Handle chained elif/else
            alt = node.child_by_field_name("alternative")
            if alt:
                self._handle_alternative(alt, cond_text)

        elif node.type == "else_clause":
            body = node.child_by_field_name("body")
            if body:
                indent = self._block_indent(body)
                first_stmt = None
                for child in body.children:
                    if child.is_named:
                        first_stmt = child
                        break
                if first_stmt:
                    trace = self._make_trace(
                        [
                            "BRANCH",
                            "else",
                            safe_parent,
                            str(first_stmt.start_point[0] + 1),
                            ("__tracer_depth",),
                        ],
                        indent,
                    )
                    self._add_before(first_stmt.start_point[0], trace)

                # Recurse into else body
                for child in body.children:
                    self._traverse(child)

    def _visit_for_statement(self, node):
        line = node.start_point[0]
        col = node.start_point[1]

        body = node.child_by_field_name("body")
        if not body:
            return

        indent = self._block_indent(body)
        first_stmt = None
        for child in body.children:
            if child.is_named:
                first_stmt = child
                break

        if not first_stmt:
            return

        stmt_line = first_stmt.start_point[0]

        # LOOP trace
        right = node.child_by_field_name("right")
        iter_text = get_text(right, self.code_bytes) if right else ""
        safe_iter = iter_text.replace("'", "\\'")

        trace = self._make_trace(
            [
                "LOOP",
                "for",
                safe_iter,
                "1",
                str(line + 1),
                ("__tracer_depth",),
            ],
            indent,
        )
        self._add_before(stmt_line, trace)

        # DECL for iteration variable
        left = node.child_by_field_name("left")
        if left and left.type == "identifier":
            var_name = get_text(left, self.code_bytes)
            self.seen_vars.add(var_name)
            decl_trace = self._make_trace(
                [
                    "DECL",
                    var_name,
                    (var_name,),
                    (f"format(id({var_name}), 'x')",),
                    str(line + 1),
                    ("__tracer_depth",),
                ],
                indent,
            )
            self._add_before(stmt_line, decl_trace)

    def _visit_while_statement(self, node):
        cond_node = node.child_by_field_name("condition")
        cond_text = get_text(cond_node, self.code_bytes) if cond_node else ""
        safe_cond = cond_text.replace("'", "\\'")

        line = node.start_point[0]

        body = node.child_by_field_name("body")
        if not body:
            return

        indent = self._block_indent(body)
        first_stmt = None
        for child in body.children:
            if child.is_named:
                first_stmt = child
                break

        if not first_stmt:
            return

        stmt_line = first_stmt.start_point[0]

        trace = self._make_trace(
            [
                "LOOP",
                "while",
                safe_cond,
                (cond_text,),
                str(line + 1),
                ("__tracer_depth",),
            ],
            indent,
        )
        self._add_before(stmt_line, trace)

    def _visit_return_statement(self, node):
        line = node.start_point[0]
        col = node.start_point[1]

        # Find the return value expression (first named child after 'return')
        ret_val = None
        for child in node.children:
            if child.is_named:
                ret_val = child
                break

        if ret_val:
            if ret_val.type == "identifier":
                var_name = get_text(ret_val, self.code_bytes)
                if var_name not in KEYWORDS:
                    trace = self._make_trace(
                        [
                            "RETURN",
                            var_name,
                            (var_name,),
                            (f"format(id({var_name}), 'x')",),
                            str(line + 1),
                            ("__tracer_depth",),
                        ],
                        col,
                    )
                    self._add_before(line, trace)
            else:
                val_text = get_text(ret_val, self.code_bytes)
                trace = self._make_trace(
                    [
                        "RETURN",
                        "literal",
                        val_text,
                        "0",
                        str(line + 1),
                        ("__tracer_depth",),
                    ],
                    col,
                )
                self._add_before(line, trace)

        self._add_before(line, f"{' ' * col}__tracer_depth -= 1")

    def _visit_call(self, node):
        """Handle function calls - mark external calls with EXTERNAL_CALL trace."""
        func_node = node.child_by_field_name("function")
        if not func_node:
            return
        
        # Get the function name (handle identifiers and attribute access)
        func_name = None
        if func_node.type == "identifier":
            func_name = get_text(func_node, self.code_bytes)
        elif func_node.type == "attribute":
            # For module.function() calls, get just the function name
            attr_node = func_node.child_by_field_name("attribute")
            if attr_node:
                func_name = get_text(attr_node, self.code_bytes)
        
        if not func_name:
            return
        
        # Skip if it's a known keyword or built-in
        if func_name in KEYWORDS:
            return
        
        # Check if this is an external function (not defined in current file)
        if func_name not in self.defined_functions:
            line = node.start_point[0]
            # Get indentation of the current line
            line_text = self.lines[line]
            indent = len(line_text) - len(line_text.lstrip())
            trace = self._make_trace(
                [
                    "EXTERNAL_CALL",
                    func_name,
                    str(line + 1),
                    ("__tracer_depth",),
                ],
                indent,
            )
            self._add_before(line, trace)


# ── Registration ─────────────────────────────────────────────────────


@register
class PythonLanguage(LanguageSupport):
    name = "python"
    extensions = frozenset({".py"})

    def get_ts_language(self):
        return Language(language())

    def analyze_types(self, ts_parser, code_bytes):
        return PythonTypeAnalyzer(ts_parser, code_bytes).analyze()

    def collect_metadata(self, ts_parser, code_bytes, source_file):
        return PythonMetadataCollector(ts_parser, code_bytes, source_file).collect()

    def instrument(self, ts_parser, code_bytes, symbol_table, metadata):
        return PythonInstrumenter(
            ts_parser, code_bytes, symbol_table, metadata
        ).instrument()
