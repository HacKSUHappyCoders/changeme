INPUT  ?= tests/00001.c
OUTPUT := instrumented_$(notdir $(INPUT))

.PHONY: all clean


all: $(OUTPUT)
	gcc $(OUTPUT) -o exe
	./exe > trace_output.txt

$(OUTPUT): $(INPUT)
	uv run python -m tracer $< -o $@

clean:
	rm -f instrumented_*.c exe trace_output.txt
