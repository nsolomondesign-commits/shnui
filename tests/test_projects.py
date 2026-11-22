import math

import numpy as np
import pytest
from fastapi.testclient import TestClient

from backend import main
from tests.pdf_fixture import HEIGHT, WIDTH, pdf, plan


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "DATA", tmp_path)
    with TestClient(main.app) as client:
        yield client


def file(data):
    return ("plan.pdf", data, "application/pdf")


@pytest.mark.parametrize("dx,dy,degrees,scale,edit", [
    (25, -21, 0, 1, False),
    (94, -19, 14, 1, False),
    (28, 21, 0, 0.77, False),
    (101, 7, 17, 0.82, True),
])
def test_registration(client, dx, dy, degrees, scale, edit):
    original = plan()
    response = client.post("/api/projects", files={
        "source": file(pdf(original)),
        "revision": file(pdf(original, dx=dx, dy=dy, degrees=degrees, scale=scale, edit=edit)),
    })
    assert response.status_code == 201, response.text
    project = response.json()
    registration = project["registration"]
    assert registration["quality"] in ("good", "review")
    assert registration["metrics"]["inliers"] >= 10
    matrix = np.array(registration["matrix"])
    angle = math.radians(degrees)
    a, b = scale * math.cos(angle), scale * math.sin(angle)
    factor = 1600 / WIDTH
    expected = np.array([[a, b, factor * (dx - b * HEIGHT)],
                         [-b, a, factor * (HEIGHT - a * HEIGHT - dy)]])
    sample = np.array([[220, 240, 1], [1200, 950, 1], [350, 800, 1]])
    assert np.max(np.abs(sample @ (matrix - expected).T)) < 5.0

    url = "/api/projects/" + project["id"]
    assert client.get(url).json()["approval"] is None
    assert client.get(url + "/image/revision").content.startswith(b"\x89PNG")
    matrix[0, 2] += 4
    approval = {"matrix": matrix.tolist(), "manual": True}
    assert client.put(url + "/approval", json=approval).status_code == 200
    with TestClient(main.app) as next_session:
        assert next_session.get(url).json()["approval"] == approval


@pytest.mark.parametrize("data", [b"not PDF", b"%PDF-1.4\nbroken", pdf(pages=2)])
def test_invalid_pdf(client, data):
    response = client.post("/api/preview", files={"file": file(data)})
    assert response.status_code == 422


def test_failed_registration_requires_manual_approval(client):
    response = client.post("/api/projects", files={"source": file(pdf(plan())), "revision": file(pdf())})
    assert response.status_code == 201
    project = response.json()
    assert project["registration"]["quality"] == "failed"
    assert project["registration"]["matrix"] is None
    url = "/api/projects/" + project["id"] + "/approval"
    matrix = [[1, 0, 5], [0, 1, 0]]
    assert client.put(url, json={"matrix": matrix, "manual": False}).status_code == 422
    assert client.put(url, json={"matrix": [[1, 0, 5], [0, 2, 0]], "manual": True}).status_code == 422
    assert client.put(url, json={"matrix": matrix, "manual": True}).status_code == 200
