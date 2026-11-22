import json
import math
import os
import sqlite3
from contextlib import closing
from pathlib import Path
from threading import Lock
from uuid import UUID, uuid4

import cv2
import pypdfium2 as pdfium
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, FiniteFloat

from .registration import register

MAX_BYTES = 20 * 1024 * 1024
app = FastAPI(title="PlanDiff", max_body_size=2 * MAX_BYTES + 1024 * 1024)
DATA = Path(os.getenv("PLANDIFF_DATA", ".plandiff"))
DATA.mkdir(parents=True, exist_ok=True, mode=0o700)
PDF_LOCK = Lock()


def connect():
    db = sqlite3.connect(DATA / "projects.sqlite3")
    db.execute("""
        CREATE TABLE IF NOT EXISTS project (
            id TEXT PRIMARY KEY, metadata TEXT NOT NULL,
            source BLOB NOT NULL, revision BLOB NOT NULL, approval TEXT
        )
    """)
    return db


def render(file: UploadFile):
    data = file.file.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise HTTPException(413, "גודל הקובץ המרבי הוא 20MB.")
    if not data.startswith(b"%PDF-"):
        raise HTTPException(422, "יש לבחור קובץ PDF תקין.")
    try:
        with PDF_LOCK, pdfium.PdfDocument(data) as document:
            if len(document) != 1:
                raise HTTPException(422, "כל תכנית צריכה להכיל עמוד אחד בדיוק.")
            with closing(document[0]) as page:
                width, height = page.get_size()
                if min(width, height) <= 0 or min(width, height) / max(width, height) < 0.02:
                    raise HTTPException(422, "מידות עמוד ה-PDF אינן נתמכות.")
                with closing(page.render(scale=1600 / max(width, height), grayscale=True)) as bitmap:
                    return bitmap.to_numpy().copy(), {"width": width, "height": height}
    except (pdfium.PdfiumError, ValueError, OverflowError) as exc:
        raise HTTPException(422, "לא ניתן לקרוא את ה-PDF. יש לבחור קובץ תקין שאינו נעול.") from exc


def describe(file, image, pdf_size):
    height, width = image.shape
    return {"name": file.filename, "width": width, "height": height, "pdf_size": pdf_size}


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.post("/api/preview")
def preview(file: UploadFile = File(...)):
    image, _ = render(file)
    return Response(cv2.imencode(".png", image)[1].tobytes(), media_type="image/png")


@app.post("/api/projects", status_code=201)
def create_project(source: UploadFile = File(...), revision: UploadFile = File(...)):
    original, original_size = render(source)
    revised, revised_size = render(revision)
    project = {
        "id": str(uuid4()),
        "source": describe(source, original, original_size),
        "revision": describe(revision, revised, revised_size),
        "registration": register(original, revised),
    }
    with closing(connect()) as db, db:
        db.execute("INSERT INTO project VALUES (?, ?, ?, ?, NULL)", (
            project["id"], json.dumps(project),
            cv2.imencode(".png", original)[1].tobytes(),
            cv2.imencode(".png", revised)[1].tobytes(),
        ))
    return {**project, "approval": None}


@app.get("/api/projects/{project_id}")
def get_project(project_id: UUID):
    with closing(connect()) as db:
        row = db.execute("SELECT metadata, approval FROM project WHERE id = ?", (str(project_id),)).fetchone()
    if row is None:
        raise HTTPException(404, "הפרויקט לא נמצא.")
    return {**json.loads(row[0]), "approval": json.loads(row[1]) if row[1] else None}


@app.get("/api/projects/{project_id}/image/{plan}")
def image(project_id: UUID, plan: str):
    if plan not in ("source", "revision"):
        raise HTTPException(404)
    with closing(connect()) as db:
        row = db.execute(f"SELECT {plan} FROM project WHERE id = ?", (str(project_id),)).fetchone()
    if row is None:
        raise HTTPException(404)
    return Response(row[0], media_type="image/png", headers={"Cache-Control": "no-store"})


class Approval(BaseModel):
    matrix: tuple[
        tuple[FiniteFloat, FiniteFloat, FiniteFloat],
        tuple[FiniteFloat, FiniteFloat, FiniteFloat],
    ]
    manual: bool


@app.put("/api/projects/{project_id}/approval")
def approve(project_id: UUID, approval: Approval):
    (a, b, _), (c, d, _) = approval.matrix
    if not (0.005 <= math.hypot(a, c) <= 100 and math.isclose(a, d, abs_tol=1e-8) and math.isclose(b, -c, abs_tol=1e-8)):
        raise HTTPException(422, "מטריצת היישור אינה תקינה.")
    with closing(connect()) as db, db:
        row = db.execute("SELECT metadata FROM project WHERE id = ?", (str(project_id),)).fetchone()
        if row is None:
            raise HTTPException(404, "הפרויקט לא נמצא.")
        if json.loads(row[0])["registration"]["quality"] == "failed" and not approval.manual:
            raise HTTPException(422, "יש לתקן את היישור ידנית לפני האישור.")
        db.execute("UPDATE project SET approval = ? WHERE id = ?", (approval.model_dump_json(), str(project_id)))
    return approval
