#include <stdio.h>

int abs_val(int x) {
    return (x < 0) ? -x : x;
}

int main() {
    // Multi-declaration
    int a = 1, b = 2, c = 3;

    // Pre/post increment/decrement
    a++;
    ++b;
    c--;
    --a;

    // Do-while loop
    int count = 0;
    do {
        count++;
    } while (count < 5);

    // Switch statement
    int grade = 2;
    switch (grade) {
        case 1:
            a = 10;
            break;
        case 2:
            a = 20;
            break;
        case 3:
            a = 30;
            break;
        default:
            a = 0;
            break;
    }

    // Ternary operator
    int max = (a > b) ? a : b;
    int sign = (c >= 0) ? 1 : -1;

    // Ternary in assignment
    int result = abs_val(-42);

    // Combined: do-while with switch and ternary
    int i = 0;
    do {
        int val = (i % 2 == 0) ? i : -i;
        switch (val) {
            case 0:
                result = result + 1;
                break;
            default:
                result = result - 1;
                break;
        }
        i++;
    } while (i < 3);

    return result;
}
