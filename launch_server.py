"""Start the local server and open the hub once it responds."""
import os
import json
import socket
from pathlib import Path
import subprocess
import sys
import time
import urllib.error
import urllib.request
import webbrowser


def is_ready(url):
    try:
        with urllib.request.urlopen(url + "api/server-info", timeout=1) as response:
            project = json.load(response).get("projectPath", "")
            return Path(project).resolve() == Path(__file__).resolve().parent
    except (OSError, ValueError, urllib.error.URLError):
        return False


def open_hub(url):
    print("Open: " + url, flush=True)
    if not webbrowser.open(url):
        print("Could not open your browser automatically. Use the address above.", flush=True)


def main():
    start_port = int(os.environ.get("BFO_PORT", "8777"))
    for port in range(start_port, min(start_port + 20, 65536)):
        url = "http://localhost:%d/" % port
        if is_ready(url):
            print("This project's server is already running. Opening the website.", flush=True)
            print("Closing this launcher will not stop the existing server.", flush=True)
            open_hub(url)
            return 0
        with socket.socket() as probe:
            try:
                probe.bind(("127.0.0.1", port))
            except OSError:
                continue
        break
    else:
        print("No available server port. Close an old server window and try again.", flush=True)
        return 1
    if port != start_port:
        print("Another project is using the default port; using %d." % port, flush=True)
    print("Starting server. Keep this window open; press Ctrl+C to stop.", flush=True)
    folder = Path(__file__).resolve().parent
    environment = dict(os.environ, BFO_PORT=str(port))
    process = subprocess.Popen([sys.executable, str(folder / "server.py")], cwd=folder, env=environment)
    try:
        deadline = time.monotonic() + 60
        while time.monotonic() < deadline:
            if process.poll() is not None:
                return process.returncode or 1
            if is_ready(url):
                open_hub(url)
                return process.wait()
            time.sleep(0.3)
        print("Server did not become ready. Check the messages above.", flush=True)
        return 1
    except KeyboardInterrupt:
        return 0
    finally:
        if process.poll() is None:
            process.terminate()
            process.wait()


if __name__ == "__main__":
    sys.exit(main())
