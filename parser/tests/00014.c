#include <ctype.h>   // Character handling functions
#include <unistd.h>  // POSIX API
#include <errno.h>   // Error codes
#include <limits.h>  // System limits

// Internal function - should be fully traced
int count_digits(const char* str) {
    int count = 0;
    for (int i = 0; str[i] != '\0'; i++) {
        if (isdigit(str[i])) {  // External call to isdigit
            count++;
        }
    }
    return count;
}

// Internal function - should be fully traced
char* to_uppercase(char* str) {
    for (int i = 0; str[i] != '\0'; i++) {
        str[i] = toupper(str[i]);  // External call to toupper
    }
    return str;
}

int main() {
    // Get process ID - external call
    int pid = getpid();
    
    // Test string manipulation
    char text[] = "Hello123World456";
    int digit_count = count_digits(text);  // Internal call
    
    // Convert to uppercase
    to_uppercase(text);  // Internal call
    
    // Check system limits - external constant
    int max_int = INT_MAX;
    
    // Small sleep - external call
    sleep(1);
    
    return 0;
}
