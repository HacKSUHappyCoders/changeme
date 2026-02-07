#include <stdio.h>

// Forward declarations for mutual recursion
int isEven(int n);
int isOdd(int n);

// Mutually recursive functions
int isEven(int n) {
    if (n == 0) {
        return 1;
    }
    return isOdd(n - 1);
}

int isOdd(int n) {
    if (n == 0) {
        return 0;
    }
    return isEven(n - 1);
}

// Recursive factorial function
int factorial(int n) {
    if (n <= 1) {
        return 1;
    }
    return n * factorial(n - 1);
}

// Fibonacci with recursion
int fibonacci(int n) {
    if (n <= 1) {
        return n;
    }
    return fibonacci(n - 1) + fibonacci(n - 2);
}

// Helper function that's called by other functions
int multiply(int a, int b) {
    int result = 0;
    for (int i = 0; i < b; i++) {
        result = result + a;
    }
    return result;
}

// Function that uses loops and calls other functions
int power(int base, int exp) {
    int result = 1;
    int counter = 0;
    
    while (counter < exp) {
        result = multiply(result, base);
        counter = counter + 1;
    }
    
    return result;
}

// Function with nested loops
int sumMatrix(int size) {
    int sum = 0;
    int i = 0;
    
    while (i < size) {
        int j = 0;
        for (j = 0; j < size; j++) {
            sum = sum + i * size + j;
        }
        i = i + 1;
    }
    
    return sum;
}

// Function with multiple return paths
int classify(int num) {
    if (num < 0) {
        return -1;
    } else if (num == 0) {
        return 0;
    } else {
        return 1;
    }
}

// Deep recursion function
int deepRecursion(int depth, int value) {
    if (depth <= 0) {
        return value;
    }
    
    int temp = value * 2;
    
    if (temp > 100) {
        temp = temp - 50;
    }
    
    return deepRecursion(depth - 1, temp);
}

// Function with complex nested conditionals
int complexLogic(int a, int b, int c) {
    int result = 0;
    
    if (a > 0) {
        if (b > 0) {
            if (c > 0) {
                result = a + b + c;
            } else {
                result = a + b - c;
            }
        } else {
            if (c > 0) {
                result = a - b + c;
            } else {
                result = a - b - c;
            }
        }
    } else {
        if (b > 0) {
            result = b + c;
        } else {
            result = c;
        }
    }
    
    return result;
}

// Function that calls multiple other functions
int compute(int x, int y) {
    int a = factorial(x);
    int b = power(2, y);
    int c = multiply(a, b);
    
    if (c > 100) {
        c = c - 50;
    } else {
        c = c + 50;
    }
    
    return c;
}

// Function with triple nested loops
int tripleNested(int size) {
    int total = 0;
    
    for (int i = 0; i < size; i++) {
        for (int j = 0; j < size; j++) {
            for (int k = 0; k < size; k++) {
                total = total + i + j + k;
            }
        }
    }
    
    return total;
}

// Function with mixed loop types
int mixedLoops(int n) {
    int sum = 0;
    int i = 0;
    
    while (i < n) {
        for (int j = 0; j < n; j++) {
            int k = 0;
            while (k < j) {
                sum = sum + 1;
                k = k + 1;
            }
        }
        i = i + 1;
    }
    
    return sum;
}

// Function with early returns in loops
int findFirst(int target, int max) {
    for (int i = 0; i < max; i++) {
        if (i == target) {
            return i;
        }
        
        if (i > target + 5) {
            return -1;
        }
    }
    
    return -2;
}

// Ackermann function (highly recursive)
int ackermann(int m, int n) {
    if (m == 0) {
        return n + 1;
    } else if (n == 0) {
        return ackermann(m - 1, 1);
    } else {
        return ackermann(m - 1, ackermann(m, n - 1));
    }
}

// Function with many parameters
int multiParam(int a, int b, int c, int d, int e) {
    int result = a + b;
    result = result * c;
    result = result - d;
    result = result / e;
    return result;
}

int main() {
    int n = 5;
    int fact = factorial(n);
    
    int fib = fibonacci(6);
    
    int prod = multiply(7, 8);
    
    int pow = power(2, 3);
    
    int matrix = sumMatrix(3);
    
    int cls = classify(-5);
    
    int result = compute(4, 3);
    
    // Test mutual recursion
    int evenCheck = isEven(10);
    int oddCheck = isOdd(7);
    
    // Test deep recursion
    int deep = deepRecursion(5, 3);
    
    // Test complex logic
    int complex = complexLogic(5, -3, 2);
    
    // Test triple nested loops
    int triple = tripleNested(2);
    
    // Test mixed loops
    int mixed = mixedLoops(3);
    
    // Test early returns
    int found = findFirst(3, 10);
    
    // Test Ackermann (small values only!)
    int ack = ackermann(1, 2);
    
    // Test multi-parameter function
    int multi = multiParam(10, 2, 3, 4, 2);
    
    // Nested loops with complex bodies
    for (int outer = 0; outer < 3; outer++) {
        int inner_sum = 0;
        for (int inner = 0; inner < 2; inner++) {
            inner_sum = inner_sum + inner;
            
            if (inner_sum > 1) {
                inner_sum = inner_sum / 2;
            }
        }
        result = result + inner_sum;
    }
    
    // While loop with complex condition
    int counter = 0;
    int limit = 10;
    while (counter < limit && result < 1000) {
        counter = counter + 1;
        result = result + factorial(2);
        
        if (counter > 5) {
            int temp = counter * 2;
            result = result - temp;
        }
    }
    
    // Multiple levels of if-else
    if (result > 500) {
        if (result > 750) {
            result = result - 100;
        } else {
            result = result - 50;
        }
    } else if (result > 250) {
        result = result + 50;
    } else {
        if (result < 100) {
            result = result + 100;
        }
    }
    
    // Loop with break equivalent
    int check = 0;
    while (1) {
        check = check + 1;
        if (check >= 5) {
            break;
        }
        
        if (check == 2) {
            check = check + 1;
        }
    }
    
    // Final computation chain
    int final = multiply(result, 2);
    final = power(2, 4);
    final = factorial(5);
    
    return result + final;
}
