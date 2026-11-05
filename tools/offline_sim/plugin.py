"""pytest plugin exposing the same fixture names as genlayer-test's direct mode.

    PYTHONPATH=tools python -m pytest -p offline_sim.plugin

With the real `genlayer-test` installed, do NOT load this plugin; run plain `pytest`.
"""
import pytest

from . import sdk


@pytest.fixture
def direct_vm():
    return sdk.new_vm()


@pytest.fixture
def direct_deploy(direct_vm):
    def deploy(path, *args):
        return sdk.deploy(str(path), *args)

    return deploy


@pytest.fixture
def direct_alice():
    return bytes([0xA1]) * 20


@pytest.fixture
def direct_bob():
    return bytes([0xB2]) * 20


@pytest.fixture
def direct_charlie():
    return bytes([0xC3]) * 20
