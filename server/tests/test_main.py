def test_oversized_content_length_rejected_with_413_before_routing(client):
    # Content-Length declares more than MAX_REQUEST_BODY_BYTES (10MB), but the
    # actual body sent is tiny. If the BodySizeLimitMiddleware were NOT the
    # outermost layer (i.e. if it ran after routing/dependency resolution),
    # this request would instead hit /auth/login's route logic and come back
    # as a 422 (missing form fields) or similar - never actually reading the
    # oversized-body path. Getting 413 here proves the middleware intercepts
    # before any route/dependency code runs.
    oversized = 10 * 1024 * 1024 + 1
    resp = client.post(
        "/auth/login",
        headers={"content-length": str(oversized)},
        content=b"x",
    )
    assert resp.status_code == 413
    assert resp.json() == {"detail": "request body too large"}


def test_content_length_within_limit_is_not_rejected(client):
    # Sanity check: a small, honest Content-Length should sail straight
    # through the middleware and reach normal route handling (422 here,
    # because no form body was actually supplied - NOT 413).
    resp = client.post(
        "/auth/login",
        headers={"content-length": "1"},
        content=b"x",
    )
    assert resp.status_code != 413
