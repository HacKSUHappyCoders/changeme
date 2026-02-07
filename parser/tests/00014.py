"""Test with completely new imports"""
import re          # Regular expressions
import hashlib     # Cryptographic hashing
import base64      # Base64 encoding
from pathlib import Path  # Path manipulation
from itertools import chain, cycle  # Iterator tools
from functools import reduce  # Functional programming

# Internal function - should be fully traced
def extract_numbers(text):
    """Extract all numbers from text using regex"""
    pattern = r'\d+'
    matches = re.findall(pattern, text)  # External call to findall
    return [int(x) for x in matches]

# Internal function - should be fully traced  
def hash_text(text):
    """Create SHA256 hash of text"""
    encoder = hashlib.sha256()  # External call to sha256
    encoder.update(text.encode())  # External call to update
    return encoder.hexdigest()  # External call to hexdigest

# Internal function - should be fully traced
def encode_text(text):
    """Base64 encode text"""
    encoded = base64.b64encode(text.encode())  # External call to b64encode
    return encoded.decode()

def main():
    # Test regex extraction
    sample = "Order 123 costs $456 for 789 items"
    numbers = extract_numbers(sample)  # Internal call
    
    # Test hashing
    text = "Hello World"
    hash_value = hash_text(text)  # Internal call
    
    # Test base64 encoding
    encoded = encode_text(text)  # Internal call
    
    # Test pathlib - external call
    current_path = Path.cwd()
    
    # Test itertools - external calls
    list1 = [1, 2, 3]
    list2 = [4, 5, 6]
    combined = list(chain(list1, list2))  # External call to chain
    
    # Test functools - external call
    total = reduce(lambda x, y: x + y, numbers)  # External call to reduce
    
    print(f"Numbers: {numbers}")
    print(f"Hash: {hash_value[:16]}...")
    print(f"Encoded: {encoded}")
    print(f"Total: {total}")

if __name__ == "__main__":
    main()
