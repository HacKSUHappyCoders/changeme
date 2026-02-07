INPUT  ?= tests/00001.c
OUTPUT := instrumented_$(notdir $(INPUT))
EXT    := $(suffix $(INPUT))

.PHONY: all clean

all: $(OUTPUT)
ifeq ($(EXT),.py)
	uv run python $(OUTPUT) > trace_output.txt
else
	gcc $(OUTPUT) -o exe
	./exe > trace_output.txt
endif

$(OUTPUT): $(INPUT)
	uv run python -m tracer $< -o $@

clean:
	rm -f instrumented_*.c instrumented_*.py exe trace_output.txt
