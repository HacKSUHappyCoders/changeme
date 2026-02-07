#include <stdio.h>

int add(int a, int b) {
    return a + b;
}

int thisisdifferent(int a, int b, int c) {
    return a + b + c;
}

int main() {
    int x = add(3, 4);
    int y = thisisdifferent(1, 2, 3);
    return 0;
}
