
# AlphaRevolve Makefile

.PHONY: build test cli example1 example2 clean help

# Default target
all: build

# Build the project
build:
	npm run build

# Run tests
test:
	npm test

# Run the CLI (example usage)
# Update arguments as needed for local testing
cli: build
	npx ts-node src/cli/index.ts --help

# Run Example 1 (Sorting Benchmark)
example1: build
	npm run example1

# Run Example 2
example2: build
	npm run example2

# Clean build artifacts (optional, if you have a clean script)
clean:
	rm -rf dist
	rm -f runs/*.json

# Help
help:
	@echo "Available commands:"
	@echo "  make build      - Compile TypeScript code"
	@echo "  make test       - Run Jest tests"
	@echo "  make cli        - Show CLI help"
	@echo "  make example1   - Run the sorting benchmark example"
	@echo "  make example2   - Run example 2"
	@echo "  make clean      - Remove build artifacts"
