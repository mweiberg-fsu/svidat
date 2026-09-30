import pytest

from app.usernames import username_from_email


@pytest.mark.parametrize(
    "email,expected",
    [
        ("ustropics@gmail.com", "ustropics"),
        ("Jane.Doe@FSU.edu", "jane.doe"),
        ("a+tag@x.org", "a_tag"),
        ("..@x.org", "user"),
        ("@x.org", "user"),
    ],
)
def test_username_from_email_uses_local_part(email, expected):
    assert username_from_email(email, taken=set()) == expected


def test_username_from_email_adds_number_on_collision():
    assert username_from_email("sam@a.com", taken={"sam"}) == "sam2"
    assert username_from_email("sam@a.com", taken={"sam", "sam2"}) == "sam3"


def test_username_from_email_collision_is_case_insensitive():
    assert username_from_email("sam@a.com", taken={"Sam"}) == "sam2"
