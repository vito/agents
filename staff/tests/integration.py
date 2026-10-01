"""Exercise staff's escape hatches without model calls or writes to the user's checkout.

Run from the agents repository: dagger-dev run python3 staff/tests/integration.py
Requires an engine with both Agent and frozen Workspace Git APIs.

Committed work is harvested with git tools by address
(dag://staff/members/head?member=<name>); agents-dev's committer checks cover
that. This script covers the uncommitted half: pendingOf and salvagePending.
"""

import base64
import json
import os
from pathlib import Path
import subprocess
import tempfile
import urllib.error
import urllib.request


def query(document, **variables):
    token = base64.b64encode((os.environ["DAGGER_SESSION_TOKEN"] + ":").encode()).decode()
    request = urllib.request.Request(
        f"http://127.0.0.1:{os.environ['DAGGER_SESSION_PORT']}/query",
        data=json.dumps({"query": document, "variables": variables}).encode(),
        headers={"Authorization": "Basic " + token, "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            result = json.load(response)
    except urllib.error.HTTPError as error:
        raise RuntimeError(error.read().decode()) from error
    if result.get("errors"):
        raise RuntimeError("\n".join(error["message"] for error in result["errors"]))
    return result["data"]


def workspace_field(ws, selection):
    return query('query($ws: ID!) { node(id: $ws) { ... on Workspace { '
                 + selection + ' } } }', ws=ws)["node"]


def edit(ws, path, content):
    return workspace_field(ws, 'withNewFile(path: ' + json.dumps(path)
                           + ', contents: ' + json.dumps(content) + ') { id }')["withNewFile"]["id"]


def commit(ws, message):
    changes = workspace_field(ws, "git { uncommitted { id } }")["git"]["uncommitted"]["id"]
    return query('query($ws: ID!, $changes: ID!, $message: String!) { node(id: $ws) '
                 '{ ... on Workspace { withCommit(changes: $changes, message: $message, '
                 'date: "2026-09-06T12:00:00Z") { id } } } }',
                 ws=ws, changes=changes, message=message)["node"]["withCommit"]["id"]


def roster(ws):
    agent = query('query($ws: ID!) { llm { withWorkspace(workspace: $ws) '
                  '{ spawn(name: "fixture") } } }', ws=ws)["llm"]["withWorkspace"]["spawn"]
    return query('query($agent: ID!) { staff { withWorker(name: "worker", worker: $agent) '
                 '{ id } } }', agent=agent)["staff"]["withWorker"]["id"]


def pending_of(staff, args=""):
    return query('query($staff: ID!) { node(id: $staff) { ... on Staff { '
                 'pendingOf(name: "worker"' + args + ') } } }', staff=staff)["node"]["pendingOf"]


def salvage(staff, ws, selection, args=""):
    return query('query($staff: ID!, $ws: ID!) { node(id: $staff) { ... on Staff { '
                 'salvagePending(source: $ws, name: "worker"' + args + ') ' + selection
                 + ' } } }', staff=staff, ws=ws)["node"]["salvagePending"]


def main():
    module = str(Path(__file__).resolve().parents[1])
    query('query($ref: String!) { moduleSource(refString: $ref) '
          '{ asModule { serve(includeDependencies: true) } } }', ref=module)
    with tempfile.TemporaryDirectory(prefix="staff-git-test-") as fixture:
        def git(*args):
            return subprocess.check_output(["git", "-C", fixture, *args], text=True).strip()

        git("init", "--quiet", "--initial-branch=main")
        git("config", "user.name", "Staff Fixture")
        git("config", "user.email", "staff@example.invalid")
        Path(fixture, "file.txt").write_text("base\n")
        git("add", "file.txt")
        git("commit", "--quiet", "-m", "root fixture")
        root_sha = git("rev-parse", "HEAD")
        base = query('query($path: String!) { host { directory(path: $path) '
                     '{ asGit { head { asWorkspace { id } } } } } }', path=fixture)["host"]["directory"]["asGit"]["head"]["asWorkspace"]["id"]
        worker = commit(edit(base, "file.txt", "worker\n"), "worker change")

        # Committed-only work: nothing pending, and the hatch points at the address.
        committed_staff = roster(worker)
        clean = pending_of(committed_staff)
        assert "no uncommitted changes" in clean, clean
        assert "dag://staff/members/head?member=worker" in clean, clean
        assert salvage(committed_staff, worker, "{ isEmpty }")["isEmpty"]

        pending_staff = roster(edit(edit(worker, "pending.txt", "unfinished\n"), "file.txt", "worker pending\n"))
        pending_diff = pending_of(pending_staff)
        assert "pending.txt" in pending_diff and "+unfinished" in pending_diff, pending_diff
        assert "no uncommitted changes" in pending_of(pending_staff, ', paths: ["other/**"]')
        pending = salvage(pending_staff, worker, "{ asPatch { contents } }")
        assert "+unfinished" in pending["asPatch"]["contents"], pending
        assert "+worker pending" in pending["asPatch"]["contents"], pending
        # Overlapping edits fail unless markers are asked for.
        conflict = edit(worker, "file.txt", "mine\n")
        expect_error("markers: true", lambda: salvage(pending_staff, conflict, "{ isEmpty }"))
        marked = salvage(pending_staff, conflict, "{ asPatch { contents } }", ", markers: true")
        assert "<<<<<<<" in marked["asPatch"]["contents"], marked
        assert git("rev-parse", "HEAD") == root_sha
        assert git("status", "--porcelain") == ""
    print("PASS: pendingOf summaries/scoping, salvagePending re-anchoring, conflicts and markers")


def expect_error(fragment, action):
    try:
        action()
    except RuntimeError as error:
        if fragment is not None:
            assert fragment in str(error), str(error)
    else:
        raise AssertionError(f"expected error containing {fragment!r}")


if __name__ == "__main__":
    main()
