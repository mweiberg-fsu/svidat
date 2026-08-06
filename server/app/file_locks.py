import threading
from contextlib import contextmanager
from typing import Dict

_locks: Dict[str, threading.Lock] = {}
_registry_lock = threading.Lock()


def _get_lock(filename: str) -> threading.Lock:
    with _registry_lock:
        if filename not in _locks:
            _locks[filename] = threading.Lock()
        return _locks[filename]


@contextmanager
def file_write_lock(filename: str):
    lock = _get_lock(filename)
    with lock:
        yield
