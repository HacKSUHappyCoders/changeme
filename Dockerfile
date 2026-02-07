FROM ghcr.io/astral-sh/uv:python3.13-bookworm-slim

WORKDIR /srv

ENV UV_COMPILE_BYTECODE=1
ENV UV_LINK_MODE=copy

# Install dependencies first (cached layer)
COPY pyproject.toml .python-version uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

# Copy application code
COPY app/ app/
COPY mosiacs/ mosiacs/
RUN uv sync --frozen --no-dev

EXPOSE 3000

CMD ["uv", "run", "flask", "--app", "app:create_app", "run", "--host", "0.0.0.0", "--port", "3000"]
