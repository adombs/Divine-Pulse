"""Small dependency checks for the backend's architectural boundaries.

Run with ``python -B architecture.py`` from backend/, or through pytest.
"""

from __future__ import annotations

import ast
from pathlib import Path
import sys


def imported_modules(source: str, module: str) -> list[str]:
    """Resolve both absolute and relative imports, including imports inside functions."""
    package = module.rsplit(".", 1)[0]
    imports = []
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.Import):
            imports.extend(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            prefix = package.split(".")
            if node.level:
                prefix = prefix[: len(prefix) - node.level + 1]
                if node.module:
                    imports.append(".".join([*prefix, node.module]))
                else:
                    imports.extend(".".join([*prefix, alias.name]) for alias in node.names)
            elif node.module:
                imports.append(node.module)
    return imports


def violations_for(source: str, module: str) -> list[str]:
    layer = module.split(".")[1] if module.startswith("app.") else ""
    if layer in {"gamemem", "system"}:
        layer = "infrastructure"
    violations = []
    for imported in imported_modules(source, module):
        top = imported.split(".")[0]
        if layer in {"domain", "application"}:
            allowed = {"app.domain"} | ({"app.application"} if layer == "application" else set())
            internal = any(imported == name or imported.startswith(name + ".") for name in allowed)
            external = (
                top in sys.stdlib_module_names or top == "__future__" or (layer == "domain" and top == "pydantic")
            )
            if not internal and not external:
                violations.append(f"{module} must not import {imported}")
        elif layer == "infrastructure":
            if top == "fastapi" or any(
                imported == name or imported.startswith(name + ".")
                for name in ("app.interface", "app.main", "app.composition", "app.api")
            ):
                violations.append(f"{module} must not import {imported}")
        elif layer == "interface":
            if any(
                imported == name or imported.startswith(name + ".")
                for name in (
                    "app.infrastructure",
                    "app.gamemem",
                    "app.system",
                    "app.storage",
                    "app.config",
                    "app.composition",
                )
            ):
                violations.append(f"{module} must not import {imported}")
    if layer in {"domain", "application"}:
        for node in ast.walk(ast.parse(source)):
            if isinstance(node, ast.Call):
                name = (
                    node.func.id
                    if isinstance(node.func, ast.Name)
                    else node.func.attr
                    if isinstance(node.func, ast.Attribute)
                    else ""
                )
                if name in {
                    "open",
                    "read_text",
                    "read_bytes",
                    "write_text",
                    "write_bytes",
                    "mkdir",
                    "unlink",
                    "__import__",
                    "import_module",
                }:
                    violations.append(f"{module}:{node.lineno} performs forbidden I/O or dynamic import: {name}")
    return violations


def check(root: Path) -> list[str]:
    violations = []
    for layer in ("domain", "application", "infrastructure", "interface", "gamemem", "system"):
        for path in sorted((root / "app" / layer).rglob("*.py")):
            module = ".".join(path.relative_to(root).with_suffix("").parts)
            violations.extend(violations_for(path.read_text("utf-8"), module))
    return violations


if __name__ == "__main__":
    problems = check(Path(__file__).resolve().parent)
    print("\n".join(problems) if problems else "Backend architectural boundaries passed.")
    raise SystemExit(bool(problems))
