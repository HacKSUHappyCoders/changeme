.PHONY: make

make:
	uv run parser.py tests/00001.c
	gcc instrumented_00001.c -o exe
	./exe > Untitled-2.txt