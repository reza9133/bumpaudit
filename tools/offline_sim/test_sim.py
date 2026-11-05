"""Self-tests of the emulator: if these are wrong, every other result is meaningless."""
import json
import pytest

from offline_sim import sdk
from offline_sim.keccak import keccak256

SRC = '''
# { "Depends": "py-genlayer:x" }
from dataclasses import dataclass
from genlayer import *

@allow_storage
@dataclass
class Rec:
    n: u256
    s: str

class C(gl.Contract):
    recs: TreeMap[u256, Rec]
    arr: DynArray[u256]
    nested: TreeMap[str, DynArray[u256]]
    count: u256

    def __init__(self):
        self.count = u256(0)

    @gl.public.write
    def add(self, n: u256, s: str) -> u256:
        self.recs[n] = Rec(n=n, s=s)
        self.arr.append(n)
        self.count = u256(int(self.count) + 1)
        if s == "boom":
            raise gl.vm.UserError("[EXPECTED] boom")
        return self.count

    @gl.public.write
    def mutate(self, n: u256) -> None:
        r = self.recs.get(n)
        r.s = "changed"

    @gl.public.view
    def sneaky(self) -> int:
        self.count = u256(99)
        return 1

    @gl.public.view
    def sneaky2(self) -> int:
        self.recs.get(u256(1)).s = "x"
        return 1

    @gl.public.view
    def get(self, n: u256) -> dict:
        r = self.recs.get(n)
        return {"n": int(r.n), "s": r.s}

    @gl.public.view
    def bad_return(self) -> dict:
        return {"f": 1.5}

    @gl.public.view
    def storage_return(self) -> dict:
        return {"r": self.recs.get(u256(1))}

    @gl.public.write
    def raw_int(self) -> None:
        self.count = 5

    @gl.public.write
    def nondet_storage(self) -> None:
        def leader():
            return {"c": int(self.count)}
        gl.vm.run_nondet_unsafe(leader, lambda r: True)

    @gl.public.write
    def nondet_attached(self) -> None:
        r = self.recs.get(u256(1))
        def leader():
            return {"s": r.s}
        gl.vm.run_nondet_unsafe(leader, lambda r: True)

    @gl.public.write
    def web_outside(self) -> None:
        gl.nondet.web.render("https://example.com", mode="text")

    @gl.public.write
    def nondet_ok(self, url: str) -> str:
        def leader():
            return {"t": gl.nondet.web.render(url, mode="text")}
        out = gl.vm.run_nondet_unsafe(leader, lambda res: res.calldata["t"] == gl.nondet.web.render(url, mode="text"))
        return out["t"]

    @gl.public.write
    def leader_float(self) -> None:
        gl.vm.run_nondet_unsafe(lambda: {"x": 0.5}, lambda r: True)

    @gl.public.write
    def iterate(self) -> None:
        for x in self.arr:
            pass

    @gl.public.write
    def nested_ok(self) -> u256:
        self.nested.get_or_insert_default("k").append(u256(7))
        return u256(len(self.nested.get("k")))
'''


@pytest.fixture
def c(tmp_path, direct_vm, direct_deploy):
    p = tmp_path / "c.py"
    p.write_text(SRC)
    return direct_deploy(p)


def test_keccak_vectors():
    assert keccak256(b"").hex() == "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470"
    assert keccak256(b"abc").hex() == "4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45"


def test_address_checksum_matches_eip55_reference():
    a = sdk.Address("0x5b38da6a701c568545dcfcb03fcb875f56beddc4")
    assert a.as_hex == "0x5B38Da6a701c568545dCfcB03FcB875f56beddC4"  # value from the SDK docs


def test_roundtrip_and_u256_rules(c):
    assert c.add(1, "a") == 1
    assert c.get(1) == {"n": 1, "s": "a"}
    with pytest.raises(sdk.SimError):
        c.add(-1, "a")                      # negative -> u256 overflow in arg conversion
    with pytest.raises(sdk.SimError):
        c.add("1", "a")                     # wrong arg type
    with pytest.raises(sdk.SimError):
        c.add(1)                            # missing arg


def test_revert_rolls_everything_back(c):
    c.add(1, "a")
    with pytest.raises(sdk.UserError):
        c.add(2, "boom")
    # the failed call must not have left a record, an array item or a counter bump
    inst = c._inst
    st = inst.__dict__["_storage"]
    assert len(st["recs"]._data) == 1 and len(st["arr"]._data) == 1 and int(st["count"]) == 1


def test_live_proxy_mutation_persists(c):
    c.add(1, "a")
    c.mutate(1)
    assert c.get(1)["s"] == "changed"


def test_dataclass_is_copied_on_insert(c):
    inst = c._inst
    rec = c._module.Rec(n=sdk.u256(5), s="orig")
    inst.__dict__["_storage"]["recs"][sdk.u256(5)] = rec
    object.__setattr__(rec, "s", "later")  # mutate the caller's object after insertion
    assert inst.__dict__["_storage"]["recs"]._data[sdk.u256(5)].s == "orig"


def test_view_cannot_mutate(c):
    c.add(1, "a")
    with pytest.raises(sdk.SimError):
        c.sneaky()
    with pytest.raises(sdk.SimError):
        c.sneaky2()


def test_calldata_strictness(c):
    c.add(1, "a")
    with pytest.raises(sdk.SimError):
        c.bad_return()
    with pytest.raises(sdk.SimError):
        c.storage_return()
    with pytest.raises(sdk.SimError):
        c.leader_float()


def test_raw_int_into_u256_slot_rejected(c):
    with pytest.raises(sdk.SimError):
        c.raw_int()


def test_nondet_isolation(c):
    c.add(1, "a")
    with pytest.raises(sdk.SimError):
        c.nondet_storage()
    with pytest.raises(sdk.SimError):
        c.nondet_attached()
    with pytest.raises(sdk.SimError):
        c.web_outside()


def test_nondet_web_and_validator_capture(c, direct_vm):
    direct_vm.mock_web(r"example\.com", {"status": 200, "body": "hello"})
    assert c.nondet_ok("https://example.com/x") == "hello"
    assert direct_vm.run_validator() is True
    direct_vm._web_mocks.clear()
    direct_vm.mock_web(r"example\.com", {"status": 200, "body": "changed"})
    assert direct_vm.run_validator() is False
    assert direct_vm.run_validator(leader_result={"t": "changed"}) is True


def test_iteration_and_unknown_methods_are_refused(c):
    with pytest.raises(sdk.SimError):
        c.iterate()
    with pytest.raises(AttributeError):
        c.not_a_method()


def test_nested_container_default(c):
    assert c.nested_ok() == 1


def test_expect_revert_semantics(c, direct_vm):
    with direct_vm.expect_revert("boom"):
        c.add(3, "boom")
    with pytest.raises(AssertionError):
        with direct_vm.expect_revert("boom"):
            c.add(4, "fine")
    with pytest.raises(AssertionError):
        with direct_vm.expect_revert("different"):
            c.add(5, "boom")


def test_unsupported_storage_types_rejected_at_deploy(tmp_path, direct_vm, direct_deploy):
    for ann in ("int", "float", "list", "dict", "typing.Optional[str]"):
        p = tmp_path / f"bad_{abs(hash(ann))}.py"
        p.write_text(f"import typing\nfrom genlayer import *\nclass C(gl.Contract):\n    x: {ann}\n")
        with pytest.raises(sdk.SimError):
            direct_deploy(p)
