"""Trusted local developer runner. Runs in its own constrained, non-root container."""

import os, json, tempfile, subprocess, signal, resource, secrets
from pathlib import Path
from fastapi import FastAPI, Request, HTTPException
from pydantic import BaseModel, Field
import uvicorn

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)


class Run(BaseModel):
    source: str = Field(max_length=200000)
    debug: bool = False


def limits():
    resource.setrlimit(resource.RLIMIT_CPU, (3, 3))
    resource.setrlimit(resource.RLIMIT_AS, (384 * 1024 * 1024, 384 * 1024 * 1024))
    resource.setrlimit(resource.RLIMIT_FSIZE, (1024 * 1024, 1024 * 1024))
    resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/run")
def run(body: Run, request: Request):
    if not secrets.compare_digest(
        request.headers.get("X-Runner-Token", ""),
        os.getenv("RUNNER_TOKEN", "local-execution-token"),
    ):
        raise HTTPException(403, "Internal execution authentication required.")
    with tempfile.TemporaryDirectory(prefix="project-") as folder:
        root = Path(folder)
        source = root / "service.py"
        source.write_text(body.source)
        harness = root / "harness.py"
        trace = root / "trace.json"
        harness.write_text("""import sys,runpy,json,traceback
from pathlib import Path
source=Path(sys.argv[1]);events=[]
def capture(frame,event,arg):
    if frame.f_code.co_filename==str(source) and event=='line' and len(events)<200:
        vals={}
        for key,value in list(frame.f_locals.items())[:25]:
            if key.startswith('__'):continue
            if type(value) in [int,float,bool,str,type(None)]:vals[key]=str(value)[:200]
            else:vals[key]='<'+type(value).__name__+'>'
        events.append({'line':frame.f_lineno,'function':frame.f_code.co_name,'locals':vals})
    return capture
try:
    if sys.argv[3]=='debug':sys.settrace(capture)
    runpy.run_path(str(source),run_name='__main__')
finally:
    sys.settrace(None)
    Path(sys.argv[2]).write_text(json.dumps(events))
""")
        with (root / "stdout").open("wb") as out, (root / "stderr").open("wb") as err:
            process = subprocess.Popen(
                [
                    "python",
                    "-I",
                    str(harness),
                    str(source),
                    str(trace),
                    "debug" if body.debug else "run",
                ],
                cwd=root,
                env={
                    "PATH": "/usr/local/bin:/usr/bin:/bin",
                    "LANG": "C.UTF-8",
                    "PYTHONDONTWRITEBYTECODE": "1",
                },
                stdout=out,
                stderr=err,
                preexec_fn=limits,
                start_new_session=True,
            )
            timed_out = False
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                timed_out = True
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()
            finally:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass

        def output(name):
            return (root / name).read_bytes()[:32768].decode("utf-8", "replace")

        try:
            events = json.loads(trace.read_text()) if trace.exists() else []
            if not isinstance(events, list):
                events = []
            events = [
                e
                for e in events[:200]
                if isinstance(e, dict)
                and isinstance(e.get("line"), int)
                and isinstance(e.get("locals"), dict)
                and isinstance(e.get("function"), str)
            ]
        except (ValueError, OSError):
            events = []
        return {
            "exit_code": process.returncode,
            "timed_out": timed_out,
            "stdout": output("stdout"),
            "stderr": output("stderr"),
            "trace": events,
            "limits": {
                "wall_seconds": 5,
                "cpu_seconds": 3,
                "memory_mb": 384,
                "output_bytes": 32768,
                "trace_steps": 200,
            },
        }


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8010)
