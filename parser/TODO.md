# Parser TODO List - Known Issues

## Not Implemented / Failing Features

### Loop Control
- [ ] `break` statements in loops - mentioned in code but not traced
- [ ] `continue` statements in loops - not traced
- [ ] `do-while` loops - only `while` and `for` loops are handled
- [ ] Loop conditions that are always true (`while(1)`) - traced but may not show meaningful condition

### Function Features
- [ ] `void` functions (no return value) - may not trace properly
- [ ] Functions with no parameters but with declarations
- [ ] Function pointers - not supported
- [ ] Variadic functions (e.g., printf with variable args) - not supported

### Control Flow
- [ ] `switch` statements - not implemented
- [ ] `case` labels - not implemented  
- [ ] `goto` statements - not implemented
- [ ] Ternary operator `? :` - might not trace properly

### Data Types & Operators
- [ ] Pointer operations - basic address tracking works but not dereferencing
- [ ] Array access - not explicitly traced
- [ ] Struct member access - not supported
- [ ] Typedef declarations - not traced
- [ ] Compound assignments (`+=`, `-=`, etc.) - might not trace as assignments

### Expressions
- [ ] Complex expressions in assignments - may only trace the final value
- [ ] Pre/post increment/decrement (`++`, `--`) - not explicitly traced
- [ ] Comma operator - not supported
- [ ] sizeof operator - treated as keyword, not traced

### Other
- [ ] Multiple declarations in one statement (e.g., `int a = 1, b = 2;`)
- [ ] Global variable declarations - not traced (only function-local)
- [ ] Static variables - not distinguished from regular variables
- [ ] Inline functions - treated as regular functions
- [ ] Preprocessor directives beyond `#include` - not traced

## Working Features

### Fully Supported
- ✅ Function definitions with parameters
- ✅ Function calls with arguments
- ✅ `for` loops with conditions
- ✅ `while` loops with conditions  
- ✅ `if-else` branches
- ✅ `if-else if-else` chains
- ✅ Variable declarations with initialization
- ✅ Variable assignments
- ✅ Return statements (literal and variable)
- ✅ Basic recursion
- ✅ Nested function calls
- ✅ Nested loops (for-for, while-while, for-while, while-for)
- ✅ Nested conditionals
- ✅ Basic integer arithmetic
- ✅ Variable address tracking
- ✅ Stack depth tracking
- ✅ Metadata collection (file info, counts)

## Priority Fixes

1. **HIGH**: Add support for `break` and `continue` statements
2. **HIGH**: Add support for `do-while` loops
3. **MEDIUM**: Handle `switch-case` statements
4. **MEDIUM**: Trace compound assignment operators
5. **MEDIUM**: Handle void functions properly
6. **LOW**: Support array indexing traces
7. **LOW**: Add preprocessor directive tracking

## Notes

- The parser uses tree-sitter for C parsing, so syntax support is comprehensive
- The instrumentation only adds traces for specific node types
- Some constructs compile and run but don't generate traces
- Complex expressions are evaluated by C but not broken down in traces
