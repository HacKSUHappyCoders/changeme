#include <stdio.h>

int test_external();

int test() {
    int a = 5, b=10;
    return b-a;
}

int main() {
    printf("running internal function\n");
    printf("result: %d\n", test());

    printf("running external function\n");
    printf("result: %d\n", test_external());

    return 0;
}