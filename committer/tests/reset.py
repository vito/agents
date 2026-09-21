"""Exercise reset through real tool calls using a replay model (no provider).

Run: dagger-dev run python3 committer/tests/reset.py
Only an automatically cleaned-up temporary fixture receives host Git commits.
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


def field(node, typename, selection):
    return query('query($id: ID!) { node(id: $id) { ... on ' + typename
                 + ' { ' + selection + ' } } }', id=node)["node"]


MESSAGES = "messages { role content { kind text callId toolName arguments errored signature } }"


def reset(llm, commit, error=None, hard=None):
    history = field(llm, "LLM", MESSAGES)["messages"]
    call_id = "reset_" + str(len(history))
    arguments = {"commit": commit}
    if hard is not None:
        arguments["hard"] = hard
    history.append({"role": "assistant", "content": [{
        "kind": "TOOL_CALL", "callId": call_id, "toolName": "reset",
        "arguments": json.dumps(arguments),
    }]})
    model = "replay/" + base64.b64encode(json.dumps(history).encode()).decode()
    result = query('query($llm: ID!, $model: String!) { node(id: $llm) { ... on LLM '
                   '{ withModel(model: $model) { step { id workspace { id } '
                   + MESSAGES + ' } } } } }', llm=llm, model=model)["node"]["withModel"]["step"]
    results = [block for message in result["messages"] for block in message["content"]
               if block["kind"] == "TOOL_RESULT" and block["callId"] == call_id]
    assert results, result
    if error is None:
        assert all(not block["errored"] for block in results), results
    else:
        assert any(block["errored"] and error in block["text"] for block in results), results
    return result["id"], result["workspace"]["id"]


def edit(ws, path, contents):
    return field(ws, "Workspace", 'withNewFile(path: ' + json.dumps(path)
                 + ', contents: ' + json.dumps(contents) + ') { id }')["withNewFile"]["id"]


def sha(ws):
    return field(ws, "Workspace", "git { head { commitSHA } }")["git"]["head"]["commitSHA"]


def contents(ws, path):
    return field(ws, "Workspace", 'file(path: ' + json.dumps(path)
                 + ') { contents }')["file"]["contents"]


def main():
    module = str(Path(__file__).resolve().parents[1])
    query('query($ref: String!) { moduleSource(refString: $ref) '
          '{ asModule { serve(includeDependencies: true) } } }', ref=module)
    with tempfile.TemporaryDirectory(prefix="committer-reset-") as fixture:
        def git(*args):
            return subprocess.check_output(["git", "-C", fixture, *args], text=True).strip()

        git("init", "--quiet", "--initial-branch=main")
        git("config", "user.name", "Reset Fixture")
        git("config", "user.email", "reset@example.invalid")
        Path(fixture, "file.txt").write_text("base\n")
        git("add", "file.txt")
        git("commit", "--quiet", "-m", "base")
        base_sha = git("rev-parse", "HEAD")
        Path(fixture, "file.txt").write_text("committed\n")
        git("commit", "--quiet", "-am", "tip")
        tip_sha = git("rev-parse", "HEAD")
        ws = query('query($path: String!) { host { directory(path: $path) '
                   '{ asGit { head { asWorkspace { id } } } } } }',
                   path=fixture)["host"]["directory"]["asGit"]["head"]["asWorkspace"]["id"]
        ws = edit(ws, "pending.txt", "original pending\n")
        base_llm = query('query($ws: ID!) { llm { withWorkspace(workspace: $ws) { id } } }',
                         ws=ws)["llm"]["withWorkspace"]["id"]
        llm = query('query($llm: ID!) { committer { agent(base: $llm) '
                    '{ withoutSystemPrompts { id } } } }', llm=base_llm)["committer"]["agent"]["withoutSystemPrompts"]["id"]

        # Hard reset to an unsaved commit replaces files and removes pending additions.
        hard_llm, clean = reset(llm, base_sha, hard=True)
        assert sha(clean) == base_sha
        assert contents(clean, "file.txt") == "base\n"
        assert field(clean, "Workspace", "git { uncommitted { isEmpty } }")["git"]["uncommitted"]["isEmpty"]
        # The discarded workspace is still recoverable with an explicit soft reset.
        hard_llm, recovered = reset(hard_llm, tip_sha, hard=False)
        assert sha(recovered) == tip_sha
        assert contents(recovered, "pending.txt") == "original pending\n"

        # Ordinary reset preserves files while moving HEAD backward.
        llm, backward = reset(llm, base_sha)
        assert sha(backward) == base_sha
        assert contents(backward, "file.txt") == "committed\n"
        assert contents(backward, "pending.txt") == "original pending\n"
        tools = field(llm, "LLM", "tools")["tools"]
        assert "reset" in tools and "withSavedWorkspace" not in tools, tools
        assert "checkFiltering" not in tools and "checkMessages" not in tools, tools

        # Change the pending work before restoring the now-pruned tip.
        changed = edit(backward, "pending.txt", "edited after reset\n")
        llm = field(llm, "LLM", 'withWorkspace(workspace: ' + json.dumps(changed)
                    + ') { id }')["withWorkspace"]["id"]
        llm, restored = reset(llm, tip_sha[:12])
        assert sha(restored) == tip_sha
        assert contents(restored, "pending.txt") == "original pending\n"

        # The second reset saved the modified backward workspace too.
        llm, returned = reset(llm, base_sha)
        assert sha(returned) == base_sha
        assert contents(returned, "pending.txt") == "edited after reset\n"
        llm, restored = reset(llm, tip_sha)
        assert sha(restored) == tip_sha
        assert contents(restored, "pending.txt") == "original pending\n"

        # Failed resets preserve the bound workspace and recovery state.
        for invalid, error in [(" ", "specify the commit"), ("not-a-sha", "reset failed")]:
            llm, unchanged = reset(llm, invalid, error=error)
            assert sha(unchanged) == tip_sha
            assert contents(unchanged, "pending.txt") == "original pending\n"
        llm, returned = reset(llm, base_sha)
        assert contents(returned, "pending.txt") == "edited after reset\n"

        # Hard reset also cleans a saved, now-pruned target selected by prefix.
        llm, clean = reset(llm, tip_sha[:12], hard=True)
        assert sha(clean) == tip_sha
        assert contents(clean, "file.txt") == "committed\n"
        assert field(clean, "Workspace", "git { uncommitted { isEmpty } }")["git"]["uncommitted"]["isEmpty"]
        llm, recovered = reset(llm, base_sha)
        assert sha(recovered) == base_sha
        assert contents(recovered, "pending.txt") == "edited after reset\n"

        # Hard reset to HEAD discards edits without moving the commit.
        llm, clean = reset(llm, "HEAD", hard=True)
        assert sha(clean) == base_sha
        assert contents(clean, "file.txt") == "base\n"
        assert field(clean, "Workspace", "git { uncommitted { isEmpty } }")["git"]["uncommitted"]["isEmpty"]
        llm, recovered = reset(llm, base_sha)
        assert contents(recovered, "pending.txt") == "edited after reset\n"
        assert git("rev-parse", "HEAD") == tip_sha
        assert git("status", "--porcelain") == ""
    print("PASS: soft/hard reset, recovery, pending edits, tool rebinding, prefixes and failed resets")


if __name__ == "__main__":
    main()
