"""Install, build, and serve PlanDiff locally from a source checkout."""

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PORT = 5180


def create_app():
    from fastapi.staticfiles import StaticFiles

    from backend.main import app

    app.mount("/", StaticFiles(directory=ROOT / "dist", html=True), name="frontend")
    return app


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--serve", action="store_true", help="Serve an existing build without installing dependencies.")
    args = parser.parse_args()
    os.chdir(ROOT)
    if args.serve:
        import uvicorn

        uvicorn.run(create_app(), host="127.0.0.1", port=PORT)
        return

    if sys.version_info[:2] != (3, 12):
        parser.exit(1, "PlanDiff requires Python 3.12.\n")
    npm = shutil.which("npm.cmd" if os.name == "nt" else "npm")
    node = shutil.which("node")
    if not npm or not node or int(subprocess.check_output([node, "-p", "process.versions.node.split('.')[0]"])) < 22:
        parser.exit(1, "PlanDiff requires Node.js 22 or later, with npm.\n")

    venv = ROOT / ".venv"
    python = venv / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    try:
        subprocess.run([sys.executable, "-m", "venv", str(venv)], check=True)
        subprocess.run([str(python), "-m", "pip", "install", "-r", "requirements.txt"], check=True)
        subprocess.run([npm, "ci"], check=True)
        subprocess.run([npm, "run", "build"], check=True)
        print(f"Open PlanDiff at http://127.0.0.1:{PORT}", flush=True)
        subprocess.run([str(python), str(ROOT / "start.py"), "--serve"], check=True)
    except subprocess.CalledProcessError as error:
        parser.exit(error.returncode, "PlanDiff could not start. See the error above.\n")
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
