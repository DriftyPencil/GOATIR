import pytest

from vault.challenge_worker import (
    _declares_endpoint,
    _inspect,
    _safe_source_path,
)
from vault.models import CodebaseFile


@pytest.mark.parametrize(
    "path",
    [
        "../app.py",
        "/app.py",
        r"web\..\app.py",
        "C:/app.py",
        "web//index.html",
        "./app.py",
        "web/../app.py",
        "app.py\x00",
    ],
)
def test_rejects_unsafe_paths(path):
    assert not _safe_source_path(path)


@pytest.mark.parametrize("path", ["app.py", "web/index.html", "README.md"])
def test_accepts_canonical_paths(path):
    assert _safe_source_path(path)


def test_rejects_relative_import():
    cases = _inspect("test", "from .fastapi import FastAPI")
    assert not all(case.passed for case in cases)


def test_comment_is_not_a_route():
    files = [
        CodebaseFile(
            path="app.py",
            purpose="Test application",
            content="# @app.get('/site/example')\nvalue = 1",
        )
    ]
    assert not _declares_endpoint(files, "GET", "/site/example")


def test_route_method_must_match():
    files = [
        CodebaseFile(
            path="app.py",
            purpose="Test application",
            content=(
                "@app.get('/site/example')\n"
                "def example():\n"
                "    return {'ok': True}\n"
            ),
        )
    ]
    assert _declares_endpoint(files, "GET", "/site/example")
    assert not _declares_endpoint(files, "POST", "/site/example")