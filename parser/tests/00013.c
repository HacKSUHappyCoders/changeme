#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>
#include <time.h>

// Internal helper functions defined in this file
int add(int a, int b) {
    return a + b;
}

int multiply(int x, int y) {
    int result = x * y;
    return result;
}

double calculate_average(int arr[], int size) {
    int sum = 0;
    for (int i = 0; i < size; i++) {
        sum = add(sum, arr[i]);  // Internal call
    }
    return (double)sum / size;
}

void print_array(int arr[], int size) {
    printf("Array contents: ");  // External call (printf)
    for (int i = 0; i < size; i++) {
        printf("%d ", arr[i]);  // External call
    }
    printf("\n");  // External call
}

char* create_message(const char* name) {
    // Using malloc (external) and sprintf (external)
    char* msg = (char*)malloc(100 * sizeof(char));
    sprintf(msg, "Hello, %s!", name);
    return msg;
}

int main() {
    // External call to time
    time_t current_time = time(NULL);
    
    // External call to printf
    printf("=== Testing Internal and External Function Calls ===\n");
    
    // Internal function calls
    int sum = add(5, 3);
    int product = multiply(4, 7);
    
    printf("Sum: %d\n", sum);  // External call
    printf("Product: %d\n", product);  // External call
    
    // Array operations
    int numbers[] = {10, 20, 30, 40, 50};
    int size = 5;
    
    // Internal call
    print_array(numbers, size);
    
    // Internal call that uses external functions
    double avg = calculate_average(numbers, size);
    printf("Average: %.2f\n", avg);  // External call
    
    // String operations with external functions
    char str1[50] = "Hello";
    char str2[50] = "World";
    
    // External calls (strlen, strcat, strcpy)
    int len1 = strlen(str1);
    int len2 = strlen(str2);
    printf("Length of '%s': %d\n", str1, len1);
    
    char combined[100];
    strcpy(combined, str1);
    strcat(combined, " ");
    strcat(combined, str2);
    printf("Combined: %s\n", combined);
    
    // Math library external calls
    double x = 16.0;
    double square_root = sqrt(x);  // External call
    double power = pow(2.0, 3.0);  // External call
    
    printf("Square root of %.0f: %.2f\n", x, square_root);
    printf("2^3: %.0f\n", power);
    
    // Internal function call
    char* greeting = create_message("Developer");
    printf("%s\n", greeting);  // External call
    
    // External call to free
    free(greeting);
    
    // More external calls
    int random_num = rand() % 100;  // External call
    printf("Random number: %d\n", random_num);
    
    // Nested internal and external calls
    int nested_result = multiply(add(2, 3), add(4, 5));  // Internal calls nested
    printf("Nested result: %d\n", nested_result);  // External call
    
    return 0;
}
