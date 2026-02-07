INPUT  ?= tests/00004.c
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

normalize: all
	cat trace_output.txt | uv run normalize.py 

clean:
	rm -f instrumented_*.c instrumented_*.py exe trace_output.txt json_output.json
