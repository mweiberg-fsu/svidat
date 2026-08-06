import threading
import uuid
from dataclasses import dataclass
from enum import Enum
from typing import Callable, Dict, Optional


class JobStatus(str, Enum):
    pending = "pending"
    running = "running"
    done = "done"
    failed = "failed"


@dataclass
class Job:
    id: str
    status: JobStatus = JobStatus.pending
    error: Optional[str] = None
    result: Optional[dict] = None


_jobs: Dict[str, Job] = {}
_lock = threading.Lock()


def submit_job(target: Callable[[], dict]) -> str:
    job_id = str(uuid.uuid4())
    job = Job(id=job_id, status=JobStatus.pending)
    with _lock:
        _jobs[job_id] = job

    def runner():
        job.status = JobStatus.running
        try:
            job.result = target()
            job.status = JobStatus.done
        except Exception as exc:  # noqa: BLE001 - job failure must be captured, not raised
            job.error = str(exc)
            job.status = JobStatus.failed

    threading.Thread(target=runner, daemon=True).start()
    return job_id


def get_job(job_id: str) -> Optional[Job]:
    with _lock:
        return _jobs.get(job_id)
