#!/bin/zsh
# Double-click to run The Evolving Vault. Close this window to stop it.
cd "$(dirname "$0")"
export PATH="/opt/homebrew/bin:$HOME/.local/bin:$PATH"
if ! command -v uv >/dev/null; then
  echo "Installing uv..."; curl -LsSf https://astral.sh/uv/install.sh | sh; export PATH="$HOME/.local/bin:$PATH"
fi
[ -f .env ] || cp .env.example .env
uv sync -q
(sleep 3; open http://127.0.0.1:8000) &
echo "The Evolving Vault is running at http://127.0.0.1:8000. Close this window to stop it."
uv run uvicorn vault.main:app --host 127.0.0.1 --port 8000
