#!/usr/bin/env python3
"""OpenBot remote worker — stdlib only, bind 127.0.0.1, persist jobs on disk.

This process is meant to live on the user's Linux host (systemd user unit,
tmux, or nohup). The laptop control plane talks to it through an SSH tunnel.
It is not a sandbox and does not claim Firecracker isolation.
"""

from __future__ import annotations

import json
import os
import shutil
import socket
import subprocess
import sys
import threading
import time
import traceback
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

HOME = Path.home()
WORKER_HOME = Path(os.environ.get("OPENBOT_WORKER_HOME", HOME / ".openbot-worker")).expanduser()
PORT = int(os.environ.get("OPENBOT_WORKER_PORT", "3848"))
HOST = os.environ.get("OPENBOT_WORKER_BIND", "127.0.0.1")
TOKEN_PATH = WORKER_HOME / "token"
JOBS_DIR = WORKER_HOME / "jobs"
WORKSPACE = Path(os.environ.get("OPENBOT_WORKSPACE", HOME / "openbot-workspace")).expanduser()
LOG_PATH = WORKER_HOME / "worker.log"


def log(msg: str) -> None:
    line = f"{time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())} {msg}"
    try:
        WORKER_HOME.mkdir(parents=True, exist_ok=True)
        with LOG_PATH.open("a", encoding="utf-8") as fh:
            fh.write(line + "\n")
    except OSError:
        pass
    print(line, file=sys.stderr, flush=True)


def ensure_layout() -> str:
    WORKER_HOME.mkdir(parents=True, exist_ok=True)
    JOBS_DIR.mkdir(parents=True, exist_ok=True)
    WORKSPACE.mkdir(parents=True, exist_ok=True)
    token = os.environ.get("OPENBOT_WORKER_TOKEN", "").strip()
    if not token:
        if TOKEN_PATH.exists():
            token = TOKEN_PATH.read_text(encoding="utf-8").strip()
        else:
            token = uuid.uuid4().hex + uuid.uuid4().hex
            TOKEN_PATH.write_text(token + "\n", encoding="utf-8")
            os.chmod(TOKEN_PATH, 0o600)
    return token


TOKEN = ensure_layout()

_jobs_lock = threading.Lock()
_processes: dict[str, subprocess.Popen[str]] = {}


def _job_paths(job_id: str) -> tuple[Path, Path]:
    return JOBS_DIR / f"{job_id}.json", JOBS_DIR / f"{job_id}.log"


def load_job(job_id: str) -> dict[str, Any] | None:
    meta_path, _ = _job_paths(job_id)
    if not meta_path.exists():
        return None
    return json.loads(meta_path.read_text(encoding="utf-8"))


def save_job(job: dict[str, Any]) -> None:
    meta_path, _ = _job_paths(job["id"])
    tmp = meta_path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(job, indent=2) + "\n", encoding="utf-8")
    tmp.replace(meta_path)


def list_jobs() -> list[dict[str, Any]]:
    jobs: list[dict[str, Any]] = []
    for path in sorted(JOBS_DIR.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True):
        try:
            jobs.append(json.loads(path.read_text(encoding="utf-8")))
        except (OSError, json.JSONDecodeError):
            continue
    return jobs[:200]


def host_info() -> dict[str, Any]:
    uname = os.uname()
    try:
        load1, load5, load15 = os.getloadavg()
        load = [load1, load5, load15]
    except OSError:
        load = []
    return {
        "hostname": socket.gethostname(),
        "user": os.environ.get("USER") or os.environ.get("LOGNAME") or "",
        "cwd": str(WORKSPACE),
        "workspace": str(WORKSPACE),
        "worker_home": str(WORKER_HOME),
        "pid": os.getpid(),
        "uname": {
            "sysname": uname.sysname,
            "nodename": uname.nodename,
            "release": uname.release,
            "version": uname.version,
            "machine": uname.machine,
            "string": f"{uname.sysname} {uname.nodename} {uname.release} {uname.version} {uname.machine}",
        },
        "loadavg": load,
        "python": sys.version.split()[0],
        "persist_hint": "This worker is a long-lived process on the host. Jobs keep running if the laptop disconnects.",
    }


def _append_log(job_id: str, data: str) -> None:
    _, log_path = _job_paths(job_id)
    with log_path.open("a", encoding="utf-8") as fh:
        fh.write(data)
        fh.flush()


def run_job(job_id: str) -> None:
    job = load_job(job_id)
    if not job:
        return
    command = job["command"]
    cwd = job.get("cwd") or str(WORKSPACE)
    timeout = job.get("timeout_sec") or 0
    env = os.environ.copy()
    env["OPENBOT_JOB_ID"] = job_id
    env["OPENBOT_WORKSPACE"] = str(WORKSPACE)
    started = time.time()
    job["status"] = "running"
    job["started_at"] = started
    save_job(job)
    try:
        proc = subprocess.Popen(
            ["bash", "-lc", command],
            cwd=cwd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            env=env,
        )
        with _jobs_lock:
            _processes[job_id] = proc
        deadline = started + timeout if timeout else None
        assert proc.stdout is not None
        while True:
            if deadline and time.time() > deadline:
                proc.kill()
                _append_log(job_id, "\n[openbot] timed out, process killed\n")
                job = load_job(job_id) or job
                job["status"] = "timeout"
                job["exit_code"] = None
                job["finished_at"] = time.time()
                save_job(job)
                break
            line = proc.stdout.readline()
            if line:
                _append_log(job_id, line)
                continue
            if proc.poll() is not None:
                rest = proc.stdout.read()
                if rest:
                    _append_log(job_id, rest)
                job = load_job(job_id) or job
                job["status"] = "succeeded" if proc.returncode == 0 else "failed"
                job["exit_code"] = proc.returncode
                job["finished_at"] = time.time()
                save_job(job)
                break
            time.sleep(0.05)
    except Exception as exc:  # noqa: BLE001 — persist failure, keep worker alive
        _append_log(job_id, f"\n[openbot] worker error: {exc}\n{traceback.format_exc()}")
        job = load_job(job_id) or job
        job["status"] = "failed"
        job["exit_code"] = -1
        job["error"] = str(exc)
        job["finished_at"] = time.time()
        save_job(job)
    finally:
        with _jobs_lock:
            _processes.pop(job_id, None)


def start_job(command: str, cwd: str | None, timeout_sec: int | None) -> dict[str, Any]:
    job_id = uuid.uuid4().hex[:12]
    workdir = str(Path(cwd).expanduser()) if cwd else str(WORKSPACE)
    Path(workdir).mkdir(parents=True, exist_ok=True)
    _, log_path = _job_paths(job_id)
    log_path.write_text("", encoding="utf-8")
    job = {
        "id": job_id,
        "command": command,
        "cwd": workdir,
        "timeout_sec": timeout_sec or 0,
        "status": "queued",
        "exit_code": None,
        "created_at": time.time(),
        "started_at": None,
        "finished_at": None,
    }
    save_job(job)
    threading.Thread(target=run_job, args=(job_id,), name=f"job-{job_id}", daemon=True).start()
    return job


def read_log(job_id: str, offset: int = 0) -> tuple[str, int, bool]:
    _, log_path = _job_paths(job_id)
    if not log_path.exists():
        return "", 0, False
    data = log_path.read_text(encoding="utf-8", errors="replace")
    chunk = data[offset:]
    job = load_job(job_id)
    done = bool(job and job.get("status") not in ("queued", "running"))
    return chunk, len(data), done


def resolve_path(raw: str) -> Path:
    path = Path(raw).expanduser()
    if not path.is_absolute():
        path = WORKSPACE / path
    return path.resolve()


def read_file(raw: str, max_bytes: int = 200_000) -> dict[str, Any]:
    path = resolve_path(raw)
    if not path.exists():
        return {"ok": False, "error": f"not found: {path}"}
    if path.is_dir():
        return {"ok": False, "error": f"is a directory: {path}"}
    size = path.stat().st_size
    data = path.read_bytes()[:max_bytes]
    truncated = size > max_bytes
    try:
        text = data.decode("utf-8")
        binary = False
    except UnicodeDecodeError:
        text = data.decode("utf-8", errors="replace")
        binary = True
    return {
        "ok": True,
        "path": str(path),
        "size": size,
        "truncated": truncated,
        "binary": binary,
        "content": text,
    }


def write_file(raw: str, content: str) -> dict[str, Any]:
    path = resolve_path(raw)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    return {"ok": True, "path": str(path), "bytes": len(content.encode("utf-8"))}


def list_dir(raw: str) -> dict[str, Any]:
    path = resolve_path(raw) if raw else WORKSPACE
    if not path.exists():
        return {"ok": False, "error": f"not found: {path}"}
    if not path.is_dir():
        return {"ok": False, "error": f"not a directory: {path}"}
    entries = []
    for child in sorted(path.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower())):
        try:
            st = child.stat()
            entries.append(
                {
                    "name": child.name,
                    "path": str(child),
                    "type": "dir" if child.is_dir() else "file",
                    "size": st.st_size if child.is_file() else None,
                }
            )
        except OSError:
            continue
    return {"ok": True, "path": str(path), "entries": entries[:500]}


class Handler(BaseHTTPRequestHandler):
    server_version = "OpenBotWorker/0.1"

    def log_message(self, fmt: str, *args: Any) -> None:
        log("%s - %s" % (self.address_string(), fmt % args))

    def _auth_ok(self) -> bool:
        header = self.headers.get("Authorization", "")
        if header == f"Bearer {TOKEN}":
            return True
        qs_token = parse_qs(urlparse(self.path).query).get("token", [""])[0]
        return qs_token == TOKEN

    def _send(self, code: int, body: Any, content_type: str = "application/json") -> None:
        raw = body if isinstance(body, (bytes, bytearray)) else json.dumps(body).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(raw)

    def _read_json(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0") or "0")
        if length <= 0:
            return {}
        raw = self.rfile.read(length)
        if not raw:
            return {}
        data = json.loads(raw.decode("utf-8"))
        if not isinstance(data, dict):
            raise ValueError("JSON object required")
        return data

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"
        if path == "/health":
            self._send(200, {"ok": True, "role": "openbot-worker"})
            return
        if not self._auth_ok():
            self._send(401, {"ok": False, "error": "unauthorized"})
            return
        if path == "/v1/info":
            self._send(200, {"ok": True, **host_info()})
            return
        if path == "/v1/jobs":
            self._send(200, {"ok": True, "jobs": list_jobs()})
            return
        if path.startswith("/v1/jobs/") and path.endswith("/log"):
            job_id = path.split("/")[3]
            qs = parse_qs(parsed.query)
            offset = int(qs.get("offset", ["0"])[0] or "0")
            job = load_job(job_id)
            if not job:
                self._send(404, {"ok": False, "error": "job not found"})
                return
            chunk, end, done = read_log(job_id, offset)
            self._send(200, {"ok": True, "job": job, "chunk": chunk, "offset": end, "done": done})
            return
        if path.startswith("/v1/jobs/"):
            job_id = path.split("/")[3]
            job = load_job(job_id)
            if not job:
                self._send(404, {"ok": False, "error": "job not found"})
                return
            chunk, end, done = read_log(job_id, 0)
            self._send(200, {"ok": True, "job": job, "output": chunk, "offset": end, "done": done})
            return
        self._send(404, {"ok": False, "error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"
        if not self._auth_ok():
            self._send(401, {"ok": False, "error": "unauthorized"})
            return
        try:
            payload = self._read_json()
        except (ValueError, json.JSONDecodeError) as exc:
            self._send(400, {"ok": False, "error": f"bad json: {exc}"})
            return
        if path == "/v1/jobs":
            command = str(payload.get("command") or "").strip()
            if not command:
                self._send(400, {"ok": False, "error": "command required"})
                return
            cwd = payload.get("cwd")
            timeout = payload.get("timeout_sec")
            job = start_job(command, cwd if isinstance(cwd, str) else None, int(timeout) if timeout else 0)
            self._send(202, {"ok": True, "job": job})
            return
        if path.startswith("/v1/jobs/") and path.endswith("/cancel"):
            job_id = path.split("/")[3]
            with _jobs_lock:
                proc = _processes.get(job_id)
            if proc and proc.poll() is None:
                proc.terminate()
                try:
                    proc.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    proc.kill()
            job = load_job(job_id)
            if job and job.get("status") in ("queued", "running"):
                job["status"] = "cancelled"
                job["finished_at"] = time.time()
                save_job(job)
            self._send(200, {"ok": True, "job": job})
            return
        if path == "/v1/files/read":
            self._send(200, read_file(str(payload.get("path") or "")))
            return
        if path == "/v1/files/write":
            self._send(200, write_file(str(payload.get("path") or ""), str(payload.get("content") or "")))
            return
        if path == "/v1/files/list":
            self._send(200, list_dir(str(payload.get("path") or "")))
            return
        self._send(404, {"ok": False, "error": "not found"})


def main() -> int:
    global TOKEN
    TOKEN = ensure_layout()
    # Resume marker so reconnecting laptops can see the worker survived.
    (WORKER_HOME / "started_at").write_text(str(time.time()) + "\n", encoding="utf-8")
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    log(f"listening on {HOST}:{PORT} home={WORKER_HOME} workspace={WORKSPACE}")
    try:
        httpd.serve_forever(poll_interval=0.5)
    except KeyboardInterrupt:
        log("shutting down")
    finally:
        httpd.server_close()
    return 0


if __name__ == "__main__":
    # Allow `python3 worker.py --print-token` from bind scripts.
    if len(sys.argv) > 1 and sys.argv[1] == "--print-token":
        print(ensure_layout())
        sys.exit(0)
    if shutil.which("bash") is None:
        log("warning: bash not found; commands will fail")
    sys.exit(main())
