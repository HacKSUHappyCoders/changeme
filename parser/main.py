import argparse


def main():
    parser = argparse.ArgumentParser(description="Instrument C code for tracing.")
    parser.add_argument("input_file", help="Path to the C source file")
    parser.add_argument("-o", "--output", help="Path to the output file")
    args = parser.parse_args()


if __name__ == "__main__":
    main()
