"""A deliberately STRICT, offline emulation of the parts of the GenLayer SDK
that an Intelligent Contract like BumpAudit touches.

It exists because the real `genlayer-test` direct mode needs a ~200 MB download.
It is NOT the real GenVM. Wherever the real VM is lenient or unknown, this
emulator is strict, so that anything it accepts is very likely to be accepted
by the real thing too:

* a reverted call (``UserError``) rolls ALL storage changes back;
* storage cannot be read or written inside a non-deterministic block;
* ``gl.nondet.*`` cannot be called outside a non-deterministic block;
* ``@gl.public.view`` methods cannot mutate storage;
* storage fields are type-checked (a bare ``int`` into a ``u256`` slot, a
  ``list`` into a ``DynArray`` slot, ``float`` anywhere ... all raise);
* only the container operations that are known to work are implemented
  (TreeMap: get / [] / []= / in / len / get_or_insert_default;
  DynArray: append / len / [int]) -- no iteration, no slicing;
* values crossing the calldata boundary (public returns, leader results, event
  blobs) must be calldata-encodable: no float, set, tuple keys, dataclasses ...
"""
from __future__ import annotations

import contextlib
import copy
import dataclasses
import importlib.util
import json
import os
import re
import sys
import types
import typing

from .keccak import Keccak256 as _Keccak256, keccak256 as _keccak256


# ----------------------------------------------------------------------------
# global emulator state
# ----------------------------------------------------------------------------
class _State:
    vm: "DirectVM | None" = None
    nondet: int = 0       # >0 while inside a non-deterministic block
    readonly: int = 0     # >0 while inside a @gl.public.view call


STATE = _State()


class SimError(AssertionError):
    """The contract did something the real VM would reject (or might reject)."""


# ----------------------------------------------------------------------------
# value types
# ----------------------------------------------------------------------------
class u256(int):
    def __new__(cls, value=0):
        if isinstance(value, bool):
            raise TypeError("u256(bool) is not allowed")
        if not isinstance(value, (int, str)):
            raise TypeError(f"u256() needs an int, got {type(value).__name__}")
        number = int(value)
        if number < 0 or number >= 1 << 256:
            raise OverflowError(f"{number} does not fit in u256")
        return super().__new__(cls, number)


class Address:
    SIZE = 20

    def __init__(self, val):
        if isinstance(val, Address):
            raw = val._raw
        elif isinstance(val, str):
            if not (val.startswith("0x") and len(val) == 42):
                raise ValueError(f"bad address string {val!r}")
            raw = bytes.fromhex(val[2:])
        elif isinstance(val, (bytes, bytearray, memoryview)):
            raw = bytes(val)
            if len(raw) != 20:
                raise ValueError("address needs exactly 20 bytes")
        else:
            raise TypeError(f"cannot build Address from {type(val).__name__}")
        self._raw = raw

    @property
    def as_bytes(self) -> bytes:
        return self._raw

    @property
    def as_int(self) -> int:
        return int.from_bytes(self._raw, "little")

    @property
    def as_hex(self) -> str:  # EIP-55
        low = self._raw.hex()
        digest = _keccak256(low.encode("ascii")).hex()
        return "0x" + "".join(c.upper() if int(digest[i], 16) >= 8 else c for i, c in enumerate(low))

    def __eq__(self, other):
        return isinstance(other, Address) and other._raw == self._raw

    def __lt__(self, other):
        return self._raw < other._raw

    def __hash__(self):
        return hash(self._raw)

    def __repr__(self):
        return f"Address({self.as_hex!r})"


Keccak256 = _Keccak256


# ----------------------------------------------------------------------------
# storage type checking
# ----------------------------------------------------------------------------
class _Param:
    """TreeMap[K, V] / DynArray[T] annotation object."""

    def __init__(self, origin, args):
        self.origin = origin
        self.args = args

    def __repr__(self):
        return f"{self.origin.__name__}[{', '.join(getattr(a, '__name__', repr(a)) for a in self.args)}]"


def _is_storage_class(ann) -> bool:
    return isinstance(ann, type) and getattr(ann, "_gl_storage", False)


def _validate_annotation(ann, where: str):
    if ann in (u256, str, bool, bytes, Address):
        return
    if _is_storage_class(ann):
        for name, field_ann in typing.get_type_hints(ann).items():
            if isinstance(field_ann, _Param):
                raise SimError(f"{where}: nested container field {name!r} inside a storage dataclass is not proven to work")
            _validate_annotation(field_ann, f"{where}.{name}")
        return
    if isinstance(ann, _Param):
        for arg in ann.args:
            _validate_annotation(arg, f"{where}[...]")
        return
    raise SimError(f"{where}: unsupported storage type {ann!r} (int/float/list/dict/tuple/Optional are not storage types)")


def _check_value(ann, value, where: str):
    if ann is u256:
        if type(value) is not u256:
            raise SimError(f"{where}: expected u256, got {type(value).__name__} (wrap with u256(...))")
    elif ann is str:
        if type(value) is not str:
            raise SimError(f"{where}: expected str, got {type(value).__name__}")
    elif ann is bool:
        if type(value) is not bool:
            raise SimError(f"{where}: expected bool, got {type(value).__name__}")
    elif ann is bytes:
        if type(value) is not bytes:
            raise SimError(f"{where}: expected bytes, got {type(value).__name__}")
    elif ann is Address:
        if not isinstance(value, Address):
            raise SimError(f"{where}: expected Address, got {type(value).__name__}")
    elif _is_storage_class(ann):
        if not isinstance(value, ann):
            raise SimError(f"{where}: expected {ann.__name__}, got {type(value).__name__}")
    elif isinstance(ann, _Param):
        if not isinstance(value, ann.origin):
            raise SimError(f"{where}: expected {ann!r}, got {type(value).__name__}")
    else:  # pragma: no cover
        raise SimError(f"{where}: cannot check {ann!r}")


def _default_for(ann):
    if ann is u256:
        return u256(0)
    if ann is str:
        return ""
    if ann is bool:
        return False
    if ann is bytes:
        return b""
    if ann is Address:
        return Address(b"\x00" * 20)
    if isinstance(ann, _Param):
        return ann.origin(*ann.args)
    if _is_storage_class(ann):
        raise SimError("storage dataclasses have no implicit default; construct and assign them")
    raise SimError(f"no default for {ann!r}")  # pragma: no cover


def _guard_storage_access(what: str):
    if STATE.nondet:
        raise SimError(f"storage access ({what}) inside a non-deterministic block")


def _guard_storage_write(what: str):
    _guard_storage_access(what)
    if STATE.readonly:
        raise SimError(f"storage write ({what}) inside a @gl.public.view method")


def _attach(value):
    if _is_storage_class(type(value)):
        value = copy.deepcopy(value)
        object.__setattr__(value, "_attached", True)
    return value


class TreeMap:
    def __init__(self, key_type, value_type):
        self._k = key_type
        self._v = value_type
        self._data: dict = {}

    def __class_getitem__(cls, params):
        if not isinstance(params, tuple) or len(params) != 2:
            raise SimError("TreeMap needs exactly two type parameters")
        return _Param(cls, params)

    def _key(self, key, what):
        _guard_storage_access(what)
        _check_value(self._k, key, f"TreeMap key")
        return key

    def get(self, key, default=None):
        self._key(key, "TreeMap.get")
        return self._data.get(key, default)

    def __getitem__(self, key):
        self._key(key, "TreeMap[]")
        return self._data[key]

    def __setitem__(self, key, value):
        _guard_storage_write("TreeMap[]=")
        self._key(key, "TreeMap[]=")
        _check_value(self._v, value, "TreeMap value")
        self._data[key] = _attach(value)

    def __contains__(self, key):
        self._key(key, "TreeMap in")
        return key in self._data

    def __len__(self):
        _guard_storage_access("len(TreeMap)")
        return len(self._data)

    def get_or_insert_default(self, key):
        _guard_storage_write("TreeMap.get_or_insert_default")
        self._key(key, "TreeMap.get_or_insert_default")
        if key not in self._data:
            self._data[key] = _default_for(self._v)
        return self._data[key]

    def __iter__(self):
        raise SimError("iterating a TreeMap is not used by this project; keep it that way")


class DynArray:
    def __init__(self, item_type):
        self._t = item_type
        self._data: list = []

    def __class_getitem__(cls, params):
        if isinstance(params, tuple):
            raise SimError("DynArray takes one type parameter")
        return _Param(cls, (params,))

    def append(self, value):
        _guard_storage_write("DynArray.append")
        _check_value(self._t, value, "DynArray item")
        self._data.append(_attach(value))

    def __len__(self):
        _guard_storage_access("len(DynArray)")
        return len(self._data)

    def __getitem__(self, index):
        _guard_storage_access("DynArray[]")
        if isinstance(index, slice) or not isinstance(index, int) or isinstance(index, bool):
            raise SimError("DynArray supports only integer indexing here")
        if index < 0 or index >= len(self._data):
            raise IndexError("DynArray index out of range")
        return self._data[index]

    def __iter__(self):
        raise SimError("iterating a DynArray is not used by this project; index with range(len(...))")


def allow_storage(cls):
    """Marks a dataclass as storable and enforces typed, attached-aware attribute access."""
    cls._gl_storage = True
    hints = typing.get_type_hints(cls)
    cls._gl_hints = hints

    def __setattr__(self, name, value):
        if name.startswith("_"):
            object.__setattr__(self, name, value)
            return
        if name not in hints:
            raise SimError(f"{cls.__name__}.{name} is not a declared storage field")
        if self.__dict__.get("_attached"):
            _guard_storage_write(f"{cls.__name__}.{name}=")
        _check_value(hints[name], value, f"{cls.__name__}.{name}")
        object.__setattr__(self, name, value)

    def __getattribute__(self, name):
        if not name.startswith("_") and object.__getattribute__(self, "__dict__").get("_attached"):
            _guard_storage_access(f"{cls.__name__}.{name}")
        return object.__getattribute__(self, name)

    cls.__setattr__ = __setattr__
    cls.__getattribute__ = __getattribute__
    return cls


# ----------------------------------------------------------------------------
# calldata
# ----------------------------------------------------------------------------
def encode(value, where="value"):
    """Validate + deep-normalise a value that crosses the calldata boundary."""
    if value is None or isinstance(value, (bool, str, bytes, Address)):
        return value
    if isinstance(value, int):
        return int(value)
    if isinstance(value, float):
        raise SimError(f"{where}: float is not calldata-encodable")
    if isinstance(value, (list, tuple)):
        return [encode(v, f"{where}[{i}]") for i, v in enumerate(value)]
    if isinstance(value, dict):
        out = {}
        for k, v in value.items():
            if not isinstance(k, str):
                raise SimError(f"{where}: dict keys must be str, got {type(k).__name__}")
            out[k] = encode(v, f"{where}.{k}")
        return out
    raise SimError(f"{where}: {type(value).__name__} is not calldata-encodable")


# ----------------------------------------------------------------------------
# gl namespace
# ----------------------------------------------------------------------------
class Result:
    pass


class Return(Result):
    def __init__(self, calldata):
        self.calldata = calldata


class UserError(Exception, Result):
    def __init__(self, message: str = ""):
        super().__init__(message)
        self.message = message


class VMError(Exception, Result):
    def __init__(self, message: str = ""):
        super().__init__(message)
        self.message = message


@contextlib.contextmanager
def _nondet():
    STATE.nondet += 1
    try:
        yield
    finally:
        STATE.nondet -= 1


def _require_nondet(what: str):
    if not STATE.nondet:
        raise SimError(f"{what} called outside a non-deterministic block")


class _Web:
    @staticmethod
    def render(url, *, mode="text", **_kw):
        _require_nondet("gl.nondet.web.render")
        if mode not in ("text", "html", "screenshot"):
            raise SimError(f"unknown render mode {mode!r}")
        vm = STATE.vm
        vm.web_calls.append(url)
        for pattern, response in vm._web_mocks:
            if pattern.search(url):
                if response.get("status", 200) >= 400:
                    raise RuntimeError(f"HTTP {response['status']}")
                return response["body"]
        raise RuntimeError(f"no web mock matches {url}")


def _exec_prompt(prompt, *, response_format="text", **_kw):
    _require_nondet("gl.nondet.exec_prompt")
    if not isinstance(prompt, str):
        raise SimError("prompt must be a str")
    vm = STATE.vm
    vm.llm_prompts.append(prompt)
    for pattern, text in vm._llm_mocks:
        if pattern.search(prompt):
            if response_format == "json":
                return json.loads(text)
            return text
    raise RuntimeError("no llm mock matches the prompt")


def _run_nondet_unsafe(leader_fn, validator_fn):
    with _nondet():
        result = leader_fn()
    calldata = encode(result, "leader result")
    STATE.vm._captured_validators.append((calldata, validator_fn))
    return copy.deepcopy(calldata)


def _strict_eq(fn):
    with _nondet():
        result = fn()
    calldata = encode(result, "strict_eq result")

    def validator(leaders_res):
        if not isinstance(leaders_res, Return):
            return False
        with _nondet():
            mine = encode(fn(), "strict_eq validator")
        return mine == leaders_res.calldata

    STATE.vm._captured_validators.append((calldata, validator))
    return copy.deepcopy(calldata)


class _Message:
    @property
    def sender_address(self):
        return STATE.vm.sender

    @property
    def sender_account(self):
        return STATE.vm.sender

    value = 0


def _public_write(fn):
    fn._gl_kind = "write"
    return fn


def _public_view(fn):
    fn._gl_kind = "view"
    return fn


class _Event:
    def __init_subclass__(cls, **kw):
        super().__init_subclass__(**kw)

        def init(self, *args, **blob):
            self._args = args
            self._blob = blob

        cls.__init__ = init

    def emit(self):
        if STATE.nondet:
            raise SimError("events cannot be emitted inside a non-deterministic block")
        if STATE.readonly:
            raise SimError("events cannot be emitted from a view")
        encode(list(self._args), "event args")
        encode(self._blob, "event blob")
        STATE.vm.events.append((type(self).__name__, tuple(self._args), dict(self._blob)))


class Contract:
    _gl_fields: dict = {}

    def __init_subclass__(cls, **kw):
        super().__init_subclass__(**kw)
        fields = {}
        for name, ann in cls.__dict__.get("__annotations__", {}).items():
            _validate_annotation(ann, f"{cls.__name__}.{name}")
            fields[name] = ann
            setattr(cls, name, _Field(name, ann))
        cls._gl_fields = fields


class _Field:
    def __init__(self, name, ann):
        self.name = name
        self.ann = ann

    def __get__(self, obj, objtype=None):
        if obj is None:
            return self
        _guard_storage_access(f"self.{self.name}")
        return obj.__dict__["_storage"][self.name]

    def __set__(self, obj, value):
        _guard_storage_write(f"self.{self.name}=")
        if isinstance(self.ann, _Param):
            raise SimError(f"self.{self.name}: containers cannot be reassigned (append / index into them instead)")
        _check_value(self.ann, value, f"self.{self.name}")
        obj.__dict__["_storage"][self.name] = _attach(value)


# ----------------------------------------------------------------------------
# the direct-mode VM and the contract handle
# ----------------------------------------------------------------------------
_MISSING = object()


class DirectVM:
    def __init__(self):
        self.sender = Address(b"\x01" * 20)
        self._datetime = "2026-06-01T00:00:00Z"
        self._web_mocks: list = []
        self._llm_mocks: list = []
        self._captured_validators: list = []
        self.events: list = []
        self.llm_prompts: list = []   # emulator-only introspection
        self.web_calls: list = []     # emulator-only introspection

    # ---- environment -------------------------------------------------------
    def warp(self, iso: str):
        # mirrors the real harness quirk: the cached gl.message_raw["datetime"] is NOT refreshed
        self._datetime = iso

    def mock_web(self, pattern, response):
        self._web_mocks.append((re.compile(pattern), dict(response)))

    def mock_llm(self, pattern, text):
        self._llm_mocks.append((re.compile(pattern), text))

    def clear_validators(self):
        self._captured_validators.clear()

    # ---- assertions ----------------------------------------------------------
    @contextlib.contextmanager
    def expect_revert(self, match=None):
        try:
            yield
        except UserError as err:
            if match is not None and match not in err.message and not re.search(match, err.message):
                raise AssertionError(f"reverted with {err.message!r}, expected something matching {match!r}") from err
            return
        raise AssertionError(f"expected a revert matching {match!r}, but the call succeeded")

    # ---- validators ----------------------------------------------------------
    def run_validator(self, leader_result=_MISSING, leader_error=None):
        if not self._captured_validators:
            raise AssertionError("no validator was captured by the last call")
        captured, validator_fn = self._captured_validators[-1]
        if leader_error is not None:
            leaders_res = leader_error
        else:
            data = captured if leader_result is _MISSING else leader_result
            leaders_res = Return(encode(copy.deepcopy(data), "forged leader result"))
        with _nondet():
            return bool(validator_fn(leaders_res))


class ContractHandle:
    def __init__(self, instance):
        object.__setattr__(self, "_inst", instance)

    def __getattr__(self, name):
        inst = object.__getattribute__(self, "_inst")
        fn = getattr(type(inst), name, None)
        kind = getattr(fn, "_gl_kind", None)
        if kind is None:
            raise AttributeError(f"{name} is not a public contract method")
        return _make_call(inst, fn, kind)


def _convert_arg(ann, value, where):
    if ann is u256:
        if isinstance(value, bool) or not isinstance(value, int):
            raise SimError(f"{where}: u256 argument needs an int, got {type(value).__name__}")
        try:
            return u256(value)
        except OverflowError as err:
            raise SimError(f"{where}: {err}") from err
    if ann is str:
        if not isinstance(value, str):
            raise SimError(f"{where}: str argument needs a str, got {type(value).__name__}")
        return value
    if ann is bool:
        if not isinstance(value, bool):
            raise SimError(f"{where}: bool argument needs a bool")
        return value
    raise SimError(f"{where}: public method parameter type {ann!r} is not supported by the emulator")


def _make_call(inst, fn, kind):
    hints = typing.get_type_hints(fn)

    def call(*args, **kwargs):
        if STATE.vm is None:
            raise SimError("no VM")
        names = [n for n in fn.__code__.co_varnames[1: fn.__code__.co_argcount]]
        bound = dict(zip(names, args))
        bound.update(kwargs)
        if set(bound) != set(names):
            raise SimError(f"{fn.__name__} expects arguments {names}, got {sorted(bound)}")
        converted = {n: _convert_arg(hints.get(n), bound[n], f"{fn.__name__}({n})") for n in names}
        snapshot = copy.deepcopy(inst.__dict__["_storage"])
        events_before = len(STATE.vm.events)
        if kind == "view":
            STATE.readonly += 1
        try:
            result = fn(inst, **converted)
        except BaseException:
            if not os.environ.get("BA_SIM_NO_ROLLBACK"):    # debugging aid: prove the contract is atomic by construction
                inst.__dict__["_storage"] = snapshot          # a revert discards every write
                del STATE.vm.events[events_before:]
            raise
        finally:
            if kind == "view":
                STATE.readonly -= 1
        if kind == "view":
            inst.__dict__["_storage"] = snapshot  # views can never persist anything
        return encode(result, f"return value of {fn.__name__}")

    return call


def _build_modules():
    gl = types.ModuleType("genlayer.gl")
    gl.Contract = Contract
    gl.Event = _Event
    gl.public = types.SimpleNamespace(write=_public_write, view=_public_view)
    gl.message = _Message()
    gl.message_raw = {"datetime": "2026-06-01T00:00:00Z"}
    gl.vm = types.SimpleNamespace(
        UserError=UserError, VMError=VMError, Return=Return, Result=Result, run_nondet_unsafe=_run_nondet_unsafe
    )
    gl.nondet = types.SimpleNamespace(web=_Web, exec_prompt=_exec_prompt)
    gl.eq_principle = types.SimpleNamespace(strict_eq=_strict_eq)

    pkg = types.ModuleType("genlayer")
    pkg.gl = gl
    pkg.u256 = u256
    pkg.Address = Address
    pkg.TreeMap = TreeMap
    pkg.DynArray = DynArray
    pkg.allow_storage = allow_storage
    pkg.Keccak256 = Keccak256
    pkg.__all__ = ["gl", "u256", "Address", "TreeMap", "DynArray", "allow_storage", "Keccak256"]
    return pkg, gl


def install():
    pkg, gl = _build_modules()
    sys.modules["genlayer"] = pkg
    sys.modules["genlayer.gl"] = gl
    return pkg, gl


def new_vm() -> DirectVM:
    pkg, gl = install()
    vm = DirectVM()
    STATE.vm = vm
    STATE.nondet = 0
    STATE.readonly = 0
    gl.message_raw["datetime"] = vm._datetime
    return vm


def deploy(path: str, *args):
    spec = importlib.util.spec_from_file_location("_contract_under_test", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    classes = [
        v for v in vars(module).values()
        if isinstance(v, type) and issubclass(v, Contract) and v is not Contract
    ]
    if len(classes) != 1:
        raise SimError(f"expected exactly one gl.Contract subclass, found {len(classes)}")
    cls = classes[0]
    inst = object.__new__(cls)
    inst.__dict__["_storage"] = {name: _default_for(ann) for name, ann in cls._gl_fields.items() if not _is_storage_class(ann)}
    init = cls.__dict__.get("__init__")
    if init is not None:
        init(inst, *args)
    handle = ContractHandle(inst)
    handle._module = module  # exposed for the emulator's own self-tests only
    return handle
