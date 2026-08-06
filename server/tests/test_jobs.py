import time

from app import jobs


def test_submit_job_runs_and_completes():
    def target():
        return {"value": 42}

    job_id = jobs.submit_job(target)
    deadline = time.time() + 2
    while time.time() < deadline:
        job = jobs.get_job(job_id)
        if job.status == jobs.JobStatus.done:
            break
        time.sleep(0.01)

    job = jobs.get_job(job_id)
    assert job.status == jobs.JobStatus.done
    assert job.result == {"value": 42}


def test_submit_job_captures_failure():
    def target():
        raise ValueError("boom")

    job_id = jobs.submit_job(target)
    deadline = time.time() + 2
    while time.time() < deadline:
        job = jobs.get_job(job_id)
        if job.status == jobs.JobStatus.failed:
            break
        time.sleep(0.01)

    job = jobs.get_job(job_id)
    assert job.status == jobs.JobStatus.failed
    assert "boom" in job.error


def test_get_unknown_job_returns_none():
    assert jobs.get_job("does-not-exist") is None
