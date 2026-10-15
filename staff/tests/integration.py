"""Exercise staff without model calls or writes to the user's checkout.

Run from the agents repository: dagger-dev run python3 staff/tests/integration.py
Requires an engine with the Agent API, frozen Workspace Git APIs, and the
expertise record from dagger/dagger#14637 (LLM.expertise, Agent.parent,
LLM.spawn(expertise:)).

Committed work is harvested with git tools by address
(dag://staff/members/head?staff-member=<name>); agents-dev's committer checks cover
that. This script covers the uncommitted half: pendingOf and salvagePending.
It also covers the worker role: a worker spawned from a chief's recorded
composition has the worker tools and none of the chief's, knows its name and
its chief, stays a worker through Agent.recompose (what reload does), and
gains the chief tools only through Agent.compose with dag://staff/agent.
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


PROBE = '''type Probe {
  agent(base: LLM!): LLM! @agent {
    base.withTools(currentNode).withSystemPrompt("probe capabilities")
  }
  probeRead(source: Workspace!): String! {
    source.file("dagger.toml").contents
  }
}
'''

WORKER_PROMPT = "You are a worker agent on a staff"
CHIEF_PROMPT = "You can hire and direct a staff"
CHIEF_TOOLS = ("interruptWorker", "sendTo")


def role_workspace(module):
    """A synthetic workspace installing this staff module and a probe module."""
    staff_dir = query('query($path: String!) { host { directory(path: $path, exclude: ["tests/"]) { id } } }',
                      path=module)["host"]["directory"]["id"]
    return query('query($staff: ID!, $toml: String!, $probeToml: String!, $probe: String!) { directory { '
                 'withNewFile(path: "dagger.toml", contents: $toml) { '
                 'withDirectory(path: "staff", source: $staff) { '
                 'withNewFile(path: "probe/dagger-module.toml", contents: $probeToml) { '
                 'withNewFile(path: "probe/main.dang", contents: $probe) { asWorkspace { id } } } } } } }',
                 staff=staff_dir, probe=PROBE,
                 probeToml='name = "probe"\nengineVersion = "v1.0.0-0"\n\n[runtime]\nsource = "dang"\n',
                 toml='[modules.staff]\nsource = "staff"\n\n[modules.probe]\nsource = "probe"\n',
                 )["directory"]["withNewFile"]["withDirectory"]["withNewFile"]["withNewFile"]["asWorkspace"]["id"]


def expertise_at(ws, uri):
    return [e["id"] for e in workspace_field(ws, 'artifacts { filterUri(uri: ' + json.dumps(uri)
                                             + ') { asExpertise { id } } }')["artifacts"]["filterUri"]["asExpertise"]]


def agent_field(agent, selection):
    return query('query($agent: ID!) { node(id: $agent) { ... on Agent { ' + selection + ' } } }',
                 agent=agent)["node"]


def llm_field(llm, selection):
    return query('query($llm: ID!) { node(id: $llm) { ... on LLM { ' + selection + ' } } }', llm=llm)["node"]


CONVERSATION = 'id tools workspace { id } expertise { artifact { uri moduleName } } messages { role content { text } }'


def describe(conversation):
    """Recorded entry URIs, tools and system prompt texts of a conversation."""
    return {
        "id": conversation["id"],
        "workspace": conversation["workspace"]["id"],
        "uris": [e["artifact"]["uri"] for e in conversation["expertise"]],
        "tools": conversation["tools"],
        "prompts": [block["text"] or "" for m in conversation["messages"] if m["role"] == "SYSTEM"
                    for block in m["content"]],
    }


def agent_compose(agent, field, conversation, entries=None):
    """Run Agent.recompose or Agent.compose on `conversation`, owned by `agent`.

    recompose refreshes every recorded entry in the bound workspace: what
    Editor's reload does. compose runs and records the given entries.
    """
    args = 'conversation: $llm' + (', expertise: $entries' if entries is not None else '')
    variables = {"agent": agent, "llm": conversation["id"]}
    params = '$agent: ID!, $llm: ID!'
    if entries is not None:
        variables["entries"] = list(entries)
        params += ', $entries: [ID!]!'
    llm = query('query(' + params + ') { node(id: $agent) { ... on Agent { '
                + field + '(' + args + ') { ' + CONVERSATION + ' } } } }', **variables)["node"][field]
    return describe(llm)


def assert_worker(conversation, name):
    tools, prompts = conversation["tools"], conversation["prompts"]
    for tool in ("askChief", "pendingOf", "salvagePending", "probeRead"):
        assert tool in tools, (tool, tools)
    for tool in CHIEF_TOOLS:
        assert tool not in tools, (tool, tools)
    assert sum(WORKER_PROMPT in p for p in prompts) == 1, prompts
    assert sum(f'Your staff name is "{name}"' in p for p in prompts) == 1, prompts
    assert not any(CHIEF_PROMPT in p for p in prompts), prompts
    assert "probe capabilities" in prompts, prompts


def worker_role(module):
    ws = role_workspace(module)
    # Default composition nominates the chief role, never the worker role.
    defaults = [a["uri"] for a in workspace_field(ws, 'artifacts { filterTypes(types: ["Expertise"]) '
                                                  '{ items { uri } } }')["artifacts"]["filterTypes"]["items"]]
    assert any("staff/agent" in u for u in defaults), defaults
    assert not any("staff/worker" in u for u in defaults), defaults

    chief = query('query($ws: ID!, $entries: [ID!]!) { llm { withWorkspace(workspace: $ws) '
                  '{ spawn(name: "role-chief", expertise: $entries) } } }', ws=ws,
                  entries=expertise_at(ws, "dag://probe/agent") + expertise_at(ws, "dag://staff/agent"),
                  )["llm"]["withWorkspace"]["spawn"]
    chief_handle = agent_field(chief, "handle parent { handle }")
    assert chief_handle["parent"] is None, chief_handle
    selected = query('query($chief: ID!, $ws: ID!) { staff { workerExpertise(chief: $chief, source: $ws) '
                     '{ id artifact { uri moduleName } } } }', chief=chief, ws=ws)["staff"]["workerExpertise"]
    # The chief's record minus staff's own entries, then the worker role.
    assert [e["artifact"]["moduleName"] for e in selected] == ["probe", "staff"], selected
    assert "staff/worker" in selected[1]["artifact"]["uri"], selected

    # A chief's spawn tool records the calling chief as the worker's parent.
    # This script is no agent, so restore under a fresh handle with the chief
    # as the recorded parent instead; the entries compose after that identity
    # exists, as they do in Staff.spawn.
    worker = query('query($ws: ID!, $entries: [ID!]!, $handle: String!, $parent: String!) { llm { '
                   'withWorkspace(workspace: $ws) { spawn(name: "role-worker", handle: $handle, '
                   'parentHandle: $parent, expertise: $entries) } } }', ws=ws,
                   entries=[e["id"] for e in selected], handle="staff-role-" + os.urandom(6).hex(),
                   parent=chief_handle["handle"])["llm"]["withWorkspace"]["spawn"]
    try:
        lineage = agent_field(worker, "name parent { handle name }")
        assert lineage["name"] == "role-worker", lineage
        assert lineage["parent"]["handle"] == chief_handle["handle"], lineage

        seed = describe(agent_field(worker, "snapshot { " + CONVERSATION + " }")["snapshot"])
        assert seed["uris"] == [e["artifact"]["uri"] for e in selected], seed["uris"]
        assert_worker(seed, "role-worker")
        # `me` is the worker; its chief resolves through me.parent.
        keys = llm_field(seed["id"], 'artifacts(include: ["staff/members"]) '
                         '{ dimensionKeys(dimension: "staff-member") }')["artifacts"]["dimensionKeys"]
        assert keys == ["chief"], keys

        # Reload keeps it a worker: same record, one worker prompt, no chief tools.
        reloaded = agent_compose(worker, "recompose", seed)
        assert reloaded["uris"] == seed["uris"], reloaded["uris"]
        assert_worker(reloaded, "role-worker")

        # Becoming a chief is explicit, and survives another reload.
        promoted = agent_compose(worker, "compose", reloaded, expertise_at(ws, "dag://staff/agent"))
        assert len(promoted["uris"]) == 3, promoted["uris"]
        again = agent_compose(worker, "recompose", promoted)
        for conversation in (promoted, again):
            for tool in CHIEF_TOOLS + ("askChief",):
                assert tool in conversation["tools"], (tool, conversation["tools"])
            assert any(CHIEF_PROMPT in p for p in conversation["prompts"]), conversation["prompts"]
            assert sum('Your staff name is "role-worker"' in p for p in conversation["prompts"]) == 1
    finally:
        agent_field(worker, "stop")
        agent_field(chief, "stop")
    print("PASS: worker role tools/prompt/parent, reload stays a worker, explicit chief composition")


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
        assert "dag://staff/members/head?staff-member=worker" in clean, clean
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
    worker_role(module)


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
