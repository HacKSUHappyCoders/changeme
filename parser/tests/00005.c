#include <stdio.h>

// Simple recursive function
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

// Function with for loop
int sumRange(int n) {
    int sum = 0;
    for (int i = 0; i < n; i++) {
        sum = sum + i;
    }
    return sum;
}

// Function with while loop
int multiply(int a, int b) {
    int result = 0;
    int count = 0;
    while (count < b) {
        result = result + a;
        count = count + 1;
    }
    return result;
}

// Function with nested conditionals
int classify(int num) {
    if (num < 0) {
        return -1;
    } else if (num == 0) {
        return 0;
    } else {
        return 1;
    }
}

// Function with nested loops
int nestedSum(int rows, int cols) {
    int total = 0;
    for (int i = 0; i < rows; i++) {
        for (int j = 0; j < cols; j++) {
            total = total + i + j;
        }
    }
    return total;
}

// Function that calls other functions
int compute(int x, int y) {
    int a = factorial(x);
    int b = multiply(a, y);
    
    if (b > 50) {
        b = b - 10;
    } else {
        b = b + 10;
    }
    
    return b;
}

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

int main() {
    // Basic variable declarations and assignments
    int a = 5;
    int b = 10;
    int c = a + b;
    
    // Function calls
    int fact = factorial(5);
    int fib = fibonacci(7);
    int sum = sumRange(10);
    int prod = multiply(6, 7);
    
    // Conditional branches
    int result = 0;
    if (c > 10) {
        result = c * 2;
    } else {
        result = c + 5;
    }
    
    // Nested conditionals
    if (result > 20) {
        if (result > 30) {
            result = result - 5;
        } else {
            result = result + 5;
        }
    }
    
    // For loop
    for (int i = 0; i < 3; i++) {
        result = result + i;
    }
    
    // While loop
    int counter = 0;
    while (counter < 5) {
        result = result + 1;
        counter = counter + 1;
    }
    
    // Nested loops
    int nested = nestedSum(3, 3);
    
    for (int outer = 0; outer < 2; outer++) {
        for (int inner = 0; inner < 2; inner++) {
            result = result + outer * inner;
        }
    }
    
    // Function that calls other functions
    int comp = compute(4, 3);
    
    // Classification function
    int cls1 = classify(-5);
    int cls2 = classify(0);
    int cls3 = classify(10);
    
    // Mutual recursion
    int even = isEven(8);
    int odd = isOdd(7);
    
    // Multiple assignment chain
    int x = 1;
    x = x + 2;
    x = x * 3;
    x = x - 1;
    
    // If-else-if chain
    int final = 0;
    if (x < 5) {
        final = 1;
    } else if (x < 10) {
        final = 2;
    } else if (x < 15) {
        final = 3;
    } else {
        final = 4;
    }
    
    return result + final;
}
