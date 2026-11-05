"""Static checks: the contract only uses constructs that are known to work inside GenVM."""
import ast
import re
from pathlib import Path

import pytest
from helpers import CONTRACT

SOURCE = Path(CONTRACT).read_text(encoding="utf-8")
TREE = ast.parse(SOURCE)

KNOWN_GOOD_HEADER = '# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }'
ALLOWED_IMPORTS = {"dataclasses", "datetime", "json", "typing", "genlayer"}
ALLOWED_PARAM_TYPES = {"str", "u256", "bool"}
STORAGE_TYPES = {"u256", "str", "bool", "Address"}
PUBLIC_METHODS = {
    "register_package", "audit_release", "reaudit_release",
    "get_version", "get_limits", "get_stats", "get_package", "list_packages", "find_packages", "list_registrant_packages",
    "get_release", "find_release", "list_package_releases", "get_audit", "list_release_audits", "get_audit_notes",
    "describe_version", "preview_verdict", "check_source_url", "preview_extraction",
}


def functions():
    return [n for n in ast.walk(TREE) if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))]


def decorators(fn):
    return {ast.unparse(d) for d in fn.decorator_list}


def test_header_is_the_first_line_and_pins_the_known_sdk_hash():
    assert SOURCE.split("\n", 1)[0] == KNOWN_GOOD_HEADER


def test_source_is_pure_ascii():
    bad = [(i + 1, ch) for i, line in enumerate(SOURCE.split("\n")) for ch in line if ord(ch) > 126]
    assert bad == []


def test_only_whitelisted_imports():
    mods = set()
    for node in ast.walk(TREE):
        if isinstance(node, ast.Import):
            mods |= {a.name.split(".")[0] for a in node.names}
        elif isinstance(node, ast.ImportFrom):
            mods.add((node.module or "").split(".")[0])
    assert mods <= ALLOWED_IMPORTS, mods - ALLOWED_IMPORTS


def test_no_floats_and_no_true_division():
    assert not [n for n in ast.walk(TREE) if isinstance(n, ast.Constant) and isinstance(n.value, float)]
    assert not [n for n in ast.walk(TREE) if isinstance(n, ast.BinOp) and isinstance(n.op, (ast.Div, ast.Pow))]
    assert not [n for n in ast.walk(TREE) if isinstance(n, ast.Call) and ast.unparse(n.func) in {"float", "round", "pow"}]


def test_no_dynamic_or_io_builtins():
    banned = {"print", "open", "eval", "exec", "compile", "__import__", "getattr", "setattr", "delattr", "globals", "locals", "input", "hash", "id"}
    used = {ast.unparse(n.func) for n in ast.walk(TREE) if isinstance(n, ast.Call)}
    assert not (used & banned), used & banned


def test_the_only_exception_raised_is_gl_vm_user_error():
    raises = [n for n in ast.walk(TREE) if isinstance(n, ast.Raise)]
    assert raises
    for r in raises:
        assert isinstance(r.exc, ast.Call) and ast.unparse(r.exc.func) == "gl.vm.UserError", ast.unparse(r)


def test_user_error_messages_carry_a_classification_tag():
    for node in ast.walk(TREE):
        if isinstance(node, ast.Call) and ast.unparse(node.func) == "gl.vm.UserError":
            text = ast.unparse(node.args[0]) if node.args else ""
            assert "[EXPECTED]" in text or "[EXTERNAL]" in text or "_FAILURE_TEXT" in text, text


def test_no_bare_or_overbroad_except_besides_exception():
    for node in ast.walk(TREE):
        if isinstance(node, ast.ExceptHandler):
            assert node.type is not None and ast.unparse(node.type) != "BaseException"


def test_public_methods_are_fully_annotated_with_supported_types():
    found = set()
    for fn in functions():
        if not decorators(fn) & {"gl.public.write", "gl.public.view"}:
            continue
        found.add(fn.name)
        args = [a for a in fn.args.args if a.arg != "self"]
        assert fn.returns is not None, fn.name
        for a in args:
            assert a.annotation is not None and ast.unparse(a.annotation) in ALLOWED_PARAM_TYPES, (fn.name, a.arg)
        assert not fn.args.kwonlyargs and not fn.args.vararg and not fn.args.kwarg and not fn.args.defaults, fn.name
    assert found == PUBLIC_METHODS


def test_views_never_read_the_clock_and_never_touch_the_network_or_model():
    for fn in functions():
        if "gl.public.view" not in decorators(fn):
            continue
        calls = {ast.unparse(n.func) for n in ast.walk(fn) if isinstance(n, ast.Call)}
        assert not calls & {"_now", "_fetch_lines", "_observe", "_classify", "_consensus_audit", "gl.vm.run_nondet_unsafe"}, fn.name


def test_only_write_methods_call_the_consensus_machinery():
    callers = {fn.name for fn in functions()
               if any(isinstance(n, ast.Call) and ast.unparse(n.func) == "_consensus_audit" for n in ast.walk(fn))}
    assert callers == {"audit_release", "reaudit_release"}


def test_nondeterministic_closures_never_reference_self():
    for fn in functions():
        for inner in [n for n in ast.walk(fn) if isinstance(n, ast.FunctionDef) and n is not fn]:
            names = {n.id for n in ast.walk(inner) if isinstance(n, ast.Name)}
            assert "self" not in names, (fn.name, inner.name)


def test_module_level_helpers_have_no_self_and_no_global_mutation():
    for fn in TREE.body:
        if isinstance(fn, ast.FunctionDef):
            assert "self" not in {n.id for n in ast.walk(fn) if isinstance(n, ast.Name)}, fn.name
    mutators = {"append", "extend", "update", "add", "pop", "clear", "remove", "insert", "setdefault"}
    module_names = {t.id for n in TREE.body if isinstance(n, ast.Assign) for t in n.targets if isinstance(t, ast.Name)}
    for fn in [n for n in TREE.body if isinstance(n, ast.FunctionDef)]:
        for call in [c for c in ast.walk(fn) if isinstance(c, ast.Call) and isinstance(c.func, ast.Attribute)]:
            target = call.func.value
            if isinstance(target, ast.Name) and target.id in module_names:
                assert call.func.attr not in mutators, (fn.name, ast.unparse(call))


def test_storage_dataclasses_only_use_supported_field_types():
    classes = [n for n in TREE.body if isinstance(n, ast.ClassDef) and any("allow_storage" in ast.unparse(d) for d in n.decorator_list)]
    assert {c.name for c in classes} == {"Package", "Release", "Audit"}
    for c in classes:
        for stmt in c.body:
            if isinstance(stmt, ast.AnnAssign):
                assert ast.unparse(stmt.annotation) in STORAGE_TYPES, (c.name, ast.unparse(stmt))


def test_contract_storage_fields_use_supported_containers():
    cls = next(n for n in TREE.body if isinstance(n, ast.ClassDef) and n.name == "BumpAudit")
    allowed = re.compile(r"^(u256|TreeMap\[(u256|str|Address), (u256|str|Package|Release|Audit|DynArray\[u256\])\]|DynArray\[u256\])$")
    for stmt in cls.body:
        if isinstance(stmt, ast.AnnAssign):
            assert allowed.match(ast.unparse(stmt.annotation)), ast.unparse(stmt)


def test_container_operations_stay_within_the_proven_subset():
    allowed_methods = {"get", "get_or_insert_default", "append"}
    for fn in functions():
        for call in [c for c in ast.walk(fn) if isinstance(c, ast.Call) and isinstance(c.func, ast.Attribute)]:
            base = ast.unparse(call.func.value)
            if base.startswith("self.") and base.count(".") == 1 and not base.startswith("self._"):
                assert call.func.attr in allowed_methods, ast.unparse(call)
    # no iteration over storage containers, no slicing of them
    for node in ast.walk(TREE):
        if isinstance(node, (ast.For, ast.comprehension)):
            assert not ast.unparse(node.iter).startswith("self."), ast.unparse(node.iter)


def test_version_constant_matches_the_deployed_contract(env):
    assert env.c.get_version() == re.search(r'^VERSION = "([^"]+)"', SOURCE, re.M).group(1)


def test_contract_is_a_single_self_contained_file_of_reasonable_size():
    assert len(SOURCE.encode("utf-8")) < 120_000


README = (Path(__file__).resolve().parents[2] / "README.md").read_text(encoding="utf-8")
DESIGN = (Path(__file__).resolve().parents[2] / "docs" / "DESIGN.md").read_text(encoding="utf-8")


def test_readme_documents_every_public_method():
    missing = [name for name in sorted(PUBLIC_METHODS) if f"`{name}" not in README]
    assert missing == []


def test_readme_limits_table_matches_the_contract(env):
    labels = {
        "max name chars": "max_name_chars", "max url chars": "max_url_chars", "max entries per section": "max_items",
        "max entry chars": "max_item_chars", "max section chars": "max_block_chars", "max evidence entries": "max_evidence_items",
        "max page size": "max_page_size", "max packages per registrant": "max_packages_per_registrant",
        "max releases per package": "max_releases_per_package", "max audits per address": "max_audits_per_address",
        "max audits per release": "max_audits_per_release", "min re-audit interval seconds": "min_reaudit_interval_seconds",
    }
    rows = dict(re.findall(r"^\| (max [^|]+|min [^|]+?) \| (\d+) \|$", README, re.M))
    assert set(rows) == set(labels), set(labels) ^ set(rows)
    limits = env.c.get_limits()
    for label, key in labels.items():
        assert int(rows[label]) == limits[key], label


def test_documented_numbers_match_the_contract(env):
    limits = env.c.get_limits()
    assert limits["max_block_chars"] == 6000 and "6000 characters" in README and "<= 6000 chars" in DESIGN
    assert limits["max_items"] == 60 and "At most 60 entries" in README
    assert limits["min_block_similarity_pct"] == 80 and "20% of the union" in DESIGN
    assert limits["max_audits_per_release"] == 30 and "cap of 30" in DESIGN
    assert limits["min_reaudit_interval_seconds"] == 300 and "5 minutes" in README


def test_every_error_tag_in_the_readme_exists_in_the_contract():
    for tag in ("[EXPECTED]", "[EXTERNAL]"):
        assert tag in SOURCE and tag in README
