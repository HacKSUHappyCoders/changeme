import os
import sys
import math
import random
import json
from datetime import datetime
from collections import Counter

# Internal helper functions defined in this file
def add(a, b):
    return a + b

def multiply(x, y):
    result = x * y
    return result

def calculate_average(numbers):
    total = sum(numbers)  # External call (built-in)
    count = len(numbers)  # External call (built-in)
    return total / count if count > 0 else 0

def print_array(arr):
    print("Array contents:", arr)  # External call (built-in print)
    for item in arr:
        print(f"  - {item}")  # External call

def create_message(name):
    # Using string formatting
    return f"Hello, {name}!"

def process_data(data):
    # Mix of internal and external calls
    total = 0
    for item in data:
        total = add(total, item)  # Internal call
    return total

def analyze_text(text):
    # Using imported Counter (external)
    words = text.split()  # External call (str method)
    word_count = Counter(words)  # External call
    return dict(word_count)

def main():
    # External call to print
    print("=== Testing Internal and External Function Calls ===")
    
    # Get current time (external)
    current_time = datetime.now()  # External call
    print(f"Current time: {current_time}")  # External call
    
    # Internal function calls
    sum_result = add(5, 3)
    product_result = multiply(4, 7)
    
    print(f"Sum: {sum_result}")  # External call
    print(f"Product: {product_result}")  # External call
    
    # List operations
    numbers = [10, 20, 30, 40, 50]
    
    # Internal call
    print_array(numbers)
    
    # Internal call that uses external functions
    avg = calculate_average(numbers)
    print(f"Average: {avg}")  # External call
    
    # String operations with external functions
    str1 = "Hello"
    str2 = "World"
    
    # External calls (len, str methods)
    len1 = len(str1)
    len2 = len(str2)
    print(f"Length of '{str1}': {len1}")
    
    combined = " ".join([str1, str2])  # External call
    print(f"Combined: {combined}")
    
    # Math library external calls
    x = 16.0
    square_root = math.sqrt(x)  # External call
    power = math.pow(2.0, 3.0)  # External call
    
    print(f"Square root of {x}: {square_root}")
    print(f"2^3: {power}")
    
    # Internal function call
    greeting = create_message("Developer")
    print(greeting)  # External call
    
    # Random module external calls
    random_num = random.randint(1, 100)  # External call
    random_choice = random.choice(numbers)  # External call
    print(f"Random number: {random_num}")
    print(f"Random choice: {random_choice}")
    
    # File system operations (external)
    current_dir = os.getcwd()  # External call
    print(f"Current directory: {current_dir}")
    
    # Check if file exists (external)
    file_exists = os.path.exists(__file__)  # External call
    print(f"This file exists: {file_exists}")
    
    # Nested internal and external calls
    nested_result = multiply(add(2, 3), add(4, 5))  # Internal calls nested
    print(f"Nested result: {nested_result}")  # External call
    
    # JSON operations (external)
    data_dict = {"name": "Test", "value": 42, "active": True}
    json_string = json.dumps(data_dict)  # External call
    print(f"JSON: {json_string}")
    
    parsed_data = json.loads(json_string)  # External call
    print(f"Parsed: {parsed_data}")
    
    # Text analysis with internal and external calls
    sample_text = "hello world hello python world python"
    word_freq = analyze_text(sample_text)  # Internal call that uses external
    print(f"Word frequencies: {word_freq}")
    
    # List comprehension with internal calls
    squared = [multiply(x, x) for x in range(1, 6)]  # Internal call in comprehension
    print(f"Squared numbers: {squared}")
    
    # Using internal function
    processed = process_data(numbers)
    print(f"Processed total: {processed}")
    
    # More external calls
    sorted_numbers = sorted(numbers, reverse=True)  # External call
    max_num = max(numbers)  # External call
    min_num = min(numbers)  # External call
    
    print(f"Sorted: {sorted_numbers}")
    print(f"Max: {max_num}, Min: {min_num}")
    
    # Type conversions (external)
    int_val = int("123")  # External call
    float_val = float("3.14")  # External call
    str_val = str(42)  # External call
    
    print(f"Conversions: {int_val}, {float_val}, {str_val}")
    
    print("=== Test Complete ===")

if __name__ == "__main__":
    main()
