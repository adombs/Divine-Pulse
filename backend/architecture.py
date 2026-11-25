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


# Only the platform layer knows which OS this is: everything else asks app.system.platform.current().
PLATFORM_MODULES = ("app.system.platform", "app.system.memory_windows", "app.system.memory_macos", "app.system.memory_linux")
PLATFORM_CHECKS = {("sys", "platform"), ("os", "name"), ("ctypes", "windll"), ("subprocess", "CREATE_NO_WINDOW")}


def platform_checks(source: str, module: str) -> list[str]:
    """OS checks (sys.platform, os.name) and Windows-only APIs outside the platform layer."""
    if any(module == name or module.startswith(name + ".") for name in PLATFORM_MODULES):
        return []
    return [
        f"{module}:{node.lineno} checks the OS ({node.value.id}.{node.attr}): ask app.system.platform instead"
        for node in ast.walk(ast.parse(source))
        if isinstance(node, ast.Attribute) and isinstance(node.value, ast.Name)
        and (node.value.id, node.attr) in PLATFORM_CHECKS
    ]


def check(root: Path) -> list[str]:
    violations = []
    for path in sorted((root / "app").rglob("*.py")):
        module = ".".join(path.relative_to(root).with_suffix("").parts)
        violations.extend(platform_checks(path.read_text("utf-8"), module))
    for layer in ("domain", "application", "infrastructure", "interface", "gamemem", "system"):
        for path in sorted((root / "app" / layer).rglob("*.py")):
            module = ".".join(path.relative_to(root).with_suffix("").parts)
            violations.extend(violations_for(path.read_text("utf-8"), module))
    return violations


if __name__ == "__main__":
    problems = check(Path(__file__).resolve().parent)
    print("\n".join(problems) if problems else "Backend architectural boundaries passed.")
    raise SystemExit(bool(problems))
