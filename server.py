#!/usr/bin/env python3
"""
Pebble Automaton Lab - High Performance Server
Streams real-time events from the native C engine (pebble_engine.exe)
and serves the interactive Space-Time Diagrammer Web App.
Includes robust subprocess process management and instant kill endpoints.
"""

import http.server
import socketserver
import urllib.parse
import subprocess
import os
import sys
import json
import threading
import time
import traceback

PORT = int(os.environ.get("PORT", sys.argv[1] if len(sys.argv) > 1 else 8000))
DIRECTORY = os.path.dirname(os.path.abspath(__file__))
ENGINE_PATH = os.path.join(DIRECTORY, "pebble_engine.exe")

active_processes = set()
proc_lock = threading.Lock()

def kill_all_processes():
    with proc_lock:
        for p in list(active_processes):
            try:
                p.kill()
                p.wait(timeout=0.2)
            except Exception:
                pass
        active_processes.clear()

class PebbleHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/stop":
            kill_all_processes()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(b'{"status":"stopped"}')
            return
        self.send_error(404)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        query = urllib.parse.parse_qs(parsed.query)

        if path == "/api/status":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            status = {
                "native_engine": os.path.exists(ENGINE_PATH),
                "threads": os.cpu_count() or 8,
                "engine_path": ENGINE_PATH,
            }
            self.wfile.write(json.dumps(status).encode("utf-8"))
            return

        elif path == "/api/turbo_sim":
            rule_str = query.get("rule", ["00_00_30_13_11_06_12_17_08_00_18"])[0]
            n = query.get("n", ["11"])[0]
            steps = query.get("steps", ["10000000"])[0]
            stride = query.get("stride", ["50000"])[0]

            exe_path = os.path.join(DIRECTORY, "turbo_step_server.exe")
            if not os.path.exists(exe_path):
                self.send_error(500, "turbo_step_server.exe not found")
                return

            try:
                res = subprocess.run([exe_path, str(n), rule_str, str(steps), str(stride)],
                                     cwd=DIRECTORY, capture_output=True, text=True, timeout=60)
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(res.stdout.encode("utf-8"))
            except Exception as e:
                self.send_error(500, str(e))
            return

        elif path == "/api/stop":
            kill_all_processes()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(b'{"status":"stopped"}')
            return

        elif path == "/api/search_holdouts12":
            count = int(query.get("count", ["20"])[0])
            exe_path = os.path.join(DIRECTORY, "generate_holdouts12.exe")
            if os.path.exists(exe_path):
                # Run high-performance OpenMP holdout hunter with fast deciders
                subprocess.run([exe_path, str(count), "50000"], cwd=DIRECTORY, timeout=30)
                # Verify candidates directly through engine.js to ensure 100% decider agreement
                v_script = os.path.join(DIRECTORY, "verify_holdouts.js")
                if os.path.exists(v_script):
                    subprocess.run(["node", v_script], cwd=DIRECTORY, timeout=30)
                # Sync metadata (bouncers vs undecided, rebound counts) into JSON
                sync_script = os.path.join(DIRECTORY, "sync_holdouts12_json.py")
                if os.path.exists(sync_script):
                    subprocess.run([sys.executable, sync_script], cwd=DIRECTORY, timeout=10)

            json_path = os.path.join(DIRECTORY, "holdouts_sz12.json")
            data = []
            if os.path.exists(json_path):
                with open(json_path, "r", encoding="utf-8") as f:
                    data = json.load(f)

            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(json.dumps({"status": "ok", "total": len(data), "data": data}).encode("utf-8"))
            return

        elif path == "/api/find":
            # Kill any prior running finder process first
            kill_all_processes()

            mode = query.get("mode", ["tree"])[0]
            n = query.get("n", ["6"])[0]
            max_steps = query.get("max_steps", ["300"])[0]
            duration = query.get("duration", ["5.0"])[0]
            threads = query.get("threads", ["0"])[0]

            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "keep-alive")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()

            cmd = [
                ENGINE_PATH,
                "--mode", mode,
                "--n", str(n),
                "--max-steps", str(max_steps),
                "--duration", str(duration),
                "--threads", str(threads),
                "--holdouts-file", "holdouts.txt"
            ]

            proc = None
            try:
                proc = subprocess.Popen(
                    cmd,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True,
                    bufsize=1
                )
                with proc_lock:
                    active_processes.add(proc)

                for line in proc.stdout:
                    line = line.strip()
                    if line:
                        msg = f"data: {line}\n\n"
                        try:
                            self.wfile.write(msg.encode("utf-8"))
                            self.wfile.flush()
                        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                            # Client disconnected
                            break

                proc.wait(timeout=0.1)
            except Exception as e:
                err_msg = json.dumps({"type": "error", "error": str(e)})
                try:
                    self.wfile.write(f"data: {err_msg}\n\n".encode("utf-8"))
                    self.wfile.flush()
                except Exception:
                    pass
            finally:
                if proc:
                    if proc.poll() is None:
                        try:
                            proc.kill()
                            proc.wait(timeout=0.2)
                        except Exception:
                            pass
                    with proc_lock:
                        active_processes.discard(proc)
            return

        elif path == "/api/simulate":
            rule = query.get("rule", [""])[0]
            n = query.get("n", ["6"])[0]
            max_steps = query.get("max_steps", ["500"])[0]

            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()

            cmd = [
                ENGINE_PATH,
                "--mode", "simulate",
                "--n", str(n),
                "--rule", rule,
                "--max-steps", str(max_steps)
            ]

            try:
                result = subprocess.run(cmd, capture_output=True, text=True, check=True)
                lines = [l.strip() for l in result.stdout.strip().split("\n") if l.strip()]
                full_json = "{"
                for l in lines:
                    if l.startswith("{") and l.endswith("}"):
                        content = l[1:-1]
                        full_json += content + ","
                if full_json.endswith(","):
                    full_json = full_json[:-1]
                full_json += "}"
                self.wfile.write(full_json.encode("utf-8"))
            except Exception as e:
                self.wfile.write(json.dumps({"error": str(e)}).encode("utf-8"))
            return

        elif path == "/api/download_holdouts":
            filename = query.get("file", ["holdouts.txt"])[0]
            filepath = os.path.join(DIRECTORY, filename)
            if not os.path.exists(filepath):
                self.send_response(404)
                self.send_header("Content-Type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(b'{"error":"Holdouts file not found. Run a search first!"}')
                return

            n = query.get("n", [""])[0]
            steps = query.get("steps", [""])[0]
            download_name = f"pebble_holdouts_n{n}_steps{steps}.txt" if n else "pebble_holdouts.txt"

            self.send_response(200)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Disposition", f'attachment; filename="{download_name}"')
            self.send_header("Access-Control-Allow-Origin", "*")
            file_size = os.path.getsize(filepath)
            self.send_header("Content-Length", str(file_size))
            self.end_headers()

            with open(filepath, "rb") as f:
                while chunk := f.read(65536):
                    self.wfile.write(chunk)
            return

        elif path == "/api/holdouts":
            filename = query.get("file", ["holdouts.txt"])[0]
            filepath = os.path.join(DIRECTORY, filename)
            if not os.path.exists(filepath):
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(b'{"count":0,"samples":[]}')
                return

            limit = int(query.get("limit", ["100"])[0])
            samples = []
            count = 0
            with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith("#"):
                        count += 1
                        if len(samples) < limit:
                            samples.append(line)

            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(json.dumps({"count": count, "samples": samples}).encode("utf-8"))
            return

        return super().do_GET()

class ThreadedTCPServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    allow_reuse_address = True
    daemon_threads = True

def run_server():
    print(f"Pebble Automaton Server (Multi-threaded) running at http://localhost:{PORT}")
    sys.stdout.flush()
    while True:
        try:
            with ThreadedTCPServer(("", PORT), PebbleHandler) as httpd:
                httpd.serve_forever()
        except KeyboardInterrupt:
            kill_all_processes()
            print("\nShutting down server...")
            break
        except Exception as e:
            traceback.print_exc()
            time.sleep(1)

if __name__ == "__main__":
    run_server()
