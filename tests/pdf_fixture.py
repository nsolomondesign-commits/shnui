"""Build deterministic one-page plans using vector PDF drawing commands."""

import math
import random

WIDTH, HEIGHT = 720, 540


def plan(seed=11):
    rng = random.Random(seed)
    commands = ["1.6 w"]
    for x in range(90, 601, 100):
        for y in range(95, 406, 95):
            x1, y1 = x + rng.randrange(15), y + rng.randrange(15)
            w, h = rng.randrange(33, 87), rng.randrange(31, 75)
            commands += [
                f"{x1} {y1} {w} {h} re S",
                f"{x1 + 4} {y1 + 4} {w - 8} {h - 8} re S",
                f"{x1 + w / 2} {y1} m {x1 + w / 2} {y1 + h} l S",
                f"{x1 + 8} {y1 + 8} {rng.randrange(3, 14)} {rng.randrange(3, 14)} re f",
            ]
            for index in range(rng.randrange(2, 7)):
                mark_x, mark_y = x1 + rng.randrange(8, w - 5), y1 + rng.randrange(8, h - 5)
                commands.append(f"{mark_x} {mark_y} {3 + index} 3 re f")
    return "\n".join(commands)


def pdf(drawing="", *, dx=0, dy=0, degrees=0, scale=1, edit=False, pages=1):
    angle = math.radians(degrees)
    a, b = scale * math.cos(angle), scale * math.sin(angle)
    if edit:
        drawing += "\n3 w 240 180 m 333 222 l S"
    if not drawing.strip():
        drawing = " "
    stream = f"q\n{a} {b} {-b} {a} {dx} {dy} cm\n{drawing}\nQ".encode()
    kids = " ".join(f"{i + 4} 0 R" for i in range(pages))
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        f"<< /Type /Pages /Count {pages} /Kids [{kids}] >>".encode(),
        f"<< /Length {len(stream)} >>\nstream\n".encode() + stream + b"\nendstream",
    ] + [
        f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {WIDTH} {HEIGHT}] /Resources << >> /Contents 3 0 R >>".encode()
        for _ in range(pages)
    ]
    result = b"%PDF-1.4\n"
    offsets = []
    for number, obj in enumerate(objects, 1):
        offsets.append(len(result))
        result += f"{number} 0 obj\n".encode() + obj + b"\nendobj\n"
    start = len(result)
    result += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode()
    for offset in offsets:
        result += f"{offset:010} 00000 n \n".encode()
    return result + f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{start}\n%%EOF\n".encode()
