"""Exercise staff harvesting without model calls or writes to the user's checkout.

Run from the agents repository: dagger-dev run python3 staff/tests/integration.py
Requires an engine with both Agent and frozen Workspace Git APIs.
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
    return workspace_field(ws, 'withCommit(message: ' + json.dumps(message)
                           + ', date: "2026-09-06T12:00:00Z") { id }')["withCommit"]["id"]


def roster(ws):
    agent = query('query($ws: ID!) { llm { withWorkspace(workspace: $ws) '
                  '{ spawn(name: "fixture") } } }', ws=ws)["llm"]["withWorkspace"]["spawn"]
    return query('query($agent: ID!) { staff { withWorker(name: "worker", worker: $agent) '
                 '{ id } } }', agent=agent)["staff"]["withWorker"]["id"]


def harvest(staff, ws, field, args="", selection=""):
    return query('query($staff: ID!, $ws: ID!) { node(id: $staff) { ... on Staff { '
                 + field + '(source: $ws, name: "worker"' + args + ') ' + selection
                 + ' } } }', staff=staff, ws=ws)["node"][field]


def expect_error(fragment, action):
    try:
        action()
    except RuntimeError as error:
        assert fragment in str(error), str(error)
    else:
        raise AssertionError(f"expected error containing {fragment!r}")


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
        worker_sha = workspace_field(worker, "git { head { commitSHA } }")["git"]["head"]["commitSHA"]
        staff = roster(worker)

        log = harvest(staff, base, "logOf")
        assert worker_sha[:7] in log and "1 new" in log, log
        assert "staged" not in log, log
        patch = harvest(staff, base, "diffOf", ', commit: ' + json.dumps(worker_sha[:7]))
        assert "-base" in patch and "+worker" in patch and "worker change" in patch, patch
        root_patch = harvest(staff, base, "diffOf", ', commit: ' + json.dumps(root_sha))
        assert "+base" in root_patch and "root fixture" in root_patch, root_patch
        scoped = harvest(staff, base, "diffOf", ', commit: ' + json.dumps(worker_sha) + ', paths: ["other.txt"]')
        assert "no changes under the given paths" in scoped, scoped
        expect_error("limit must be positive", lambda: harvest(staff, base, "logOf", ", limit: 0"))
        expect_error("SHA must not be empty", lambda: harvest(staff, base, "pull", ', commits: [""]', '{ id }'))
        expect_error("has no commit", lambda: harvest(staff, base, "diffOf", ', commit: "not-a-sha"'))

        pulled = harvest(staff, base, "pull", selection="{ id git { head { commitSHA } } }")
        assert pulled["git"]["head"]["commitSHA"] == worker_sha, pulled
        again = harvest(staff, pulled["id"], "pull", selection="{ git { head { commitSHA } } }")
        assert again["git"]["head"]["commitSHA"] == worker_sha, again
        no_new = harvest(staff, pulled["id"], "logOf")
        assert "no new commits" in no_new, no_new

        chief = commit(edit(base, "chief.txt", "chief\n"), "chief change")
        divergent = harvest(staff, chief, "pull", ', commits: ' + json.dumps([worker_sha[:7]]), '{ id }')["id"]
        assert workspace_field(divergent, 'file(path: "/file.txt") { contents }')["file"]["contents"] == "worker\n"
        assert workspace_field(divergent, 'file(path: "/chief.txt") { contents }')["file"]["contents"] == "chief\n"
        duplicate = harvest(staff, divergent, "pull", selection="{ id }")["id"]
        assert workspace_field(duplicate, "git { head { commitSHA } }") == workspace_field(divergent, "git { head { commitSHA } }")

        conflict = commit(edit(base, "file.txt", "chief conflict\n"), "chief conflict")
        assert "CONFLICT" in harvest(staff, conflict, "logOf")
        refused = harvest(staff, conflict, "pull", selection="{ git { head { commitSHA } } }")
        assert refused == workspace_field(conflict, "git { head { commitSHA } }")
        recovered = harvest(staff, conflict, "pullConflicted", ', commit: ' + json.dumps(worker_sha[:7]), '{ asPatch { contents } }')
        assert "<<<<<<<" in recovered["asPatch"]["contents"], recovered

        pending_staff = roster(edit(worker, "pending.txt", "unfinished\n"))
        committed_only = harvest(pending_staff, base, "pull", selection="{ id git { uncommitted { isEmpty } } }")
        assert committed_only["git"]["uncommitted"]["isEmpty"], committed_only
        pending_diff = harvest(pending_staff, worker, "diffOf")
        assert "pending.txt" in pending_diff and "+unfinished" in pending_diff, pending_diff
        pending = harvest(pending_staff, worker, "pullPending", selection="{ asPatch { contents } }")
        assert "+unfinished" in pending["asPatch"]["contents"], pending
        empty = harvest(staff, worker, "pullPending", selection="{ isEmpty }")
        assert empty["isEmpty"], empty
        dirty = edit(base, "local.txt", "keep my uncommitted work\n")
        with_dirty = harvest(staff, dirty, "pull", selection="{ id }")["id"]
        assert workspace_field(with_dirty, 'file(path: "/local.txt") { contents }')["file"]["contents"] == "keep my uncommitted work\n"
        assert workspace_field(with_dirty, "git { uncommitted { diffStats { path } } }")["git"]["uncommitted"]["diffStats"] == [{"path": "local.txt"}]
        assert git("rev-parse", "HEAD") == root_sha
        assert git("status", "--porcelain") == ""
    print("PASS: log, root/ordinary/scoped diffs, validation, fast-forward/cherry-pick, duplicate/conflicting pulls, conflict recovery and pending edits")


if __name__ == "__main__":
    main()
