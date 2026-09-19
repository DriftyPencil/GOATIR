"""Public web deployment on Modal.

Deploy: uv run modal deploy deploy/modal_web.py
The Gemini key comes from the Modal secret "evolving-vault" (created from .env).
Sessions are in memory, so a single container serves all players.
"""

from pathlib import Path

import modal

ROOT = Path(__file__).resolve().parent.parent

image = (
    modal.Image.debian_slim(python_version="3.12")
    .pip_install(
        "fastapi>=0.115,<1",
        "pydantic>=2.10,<3",
        "pydantic-settings>=2.7,<3",
        "pydantic-ai-slim[google]>=1.0,<2",
        "modal>=1.0,<2",
        "logfire>=3.0,<5",
    )
    .env({"EVAL_BACKEND": "modal", "LOGFIRE_IGNORE_NO_CONFIG": "1"})
    .add_local_dir(ROOT / "static", "/root/static")
    .add_local_python_source("vault")
)

app = modal.App("evolving-vault-web", image=image)


@app.function(
    secrets=[modal.Secret.from_name("evolving-vault")],
    max_containers=1,
    scaledown_window=1200,
    timeout=600,
)
@modal.concurrent(max_inputs=100)
@modal.asgi_app()
def web():
    from vault.main import create_app

    return create_app()
