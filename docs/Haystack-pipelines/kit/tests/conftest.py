import importlib.util
import sys
from pathlib import Path

import pytest

KIT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(KIT))
sys.path.insert(0, str(KIT / "checks"))


def load_component(module: str, code: str | None = None):
    """Imports kit/components/<module>.py, or executes substituted code, and returns
    the module namespace (so tests can reach constants as well as the component class)."""
    if code is None:
        code = (KIT / "components" / f"{module}.py").read_text(encoding="utf-8")
    spec = importlib.util.spec_from_loader(f"kit_component_{module}_{abs(hash(code))}", loader=None)
    mod = importlib.util.module_from_spec(spec)
    exec(compile(code, f"{module}.py", "exec"), mod.__dict__)
    return mod


@pytest.fixture
def components():
    return load_component
