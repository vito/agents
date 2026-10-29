#!/usr/bin/env python3
"""Read Discord through its REST API as a bot, rendered for an agent.

    discord.py <command> <input.json>

The commands are the module's tools: servers, channels, messages, threads.
The bot token arrives in DISCORD_TOKEN, the configured default server (if
any) in DISCORD_SERVER. Output goes to stdout. A problem the caller can act
on (bad input, a rejected token, missing permissions) goes to stderr with
exit code 3; anything else is a bug and exits with a traceback.

Standard library only: the container is python:alpine and nothing else.
DISCORD_API_URL is never set by the module; the checks point it at a fake.
"""

import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

API = os.environ.get("DISCORD_API_URL", "https://discord.com/api/v10").rstrip("/")
DEFAULT_SERVER = os.environ.get("DISCORD_SERVER", "").strip()
# Discord requires this shape of User-Agent from bots.
USER_AGENT = "DiscordBot (https://github.com/vito/agents, 1)"
FAIL_EXIT = 3

DISCORD_EPOCH_MS = 1420070400000

ADMINISTRATOR = 1 << 3
VIEW_CHANNEL = 1 << 10
READ_MESSAGE_HISTORY = 1 << 16
# What the invite link asks for: reading, nothing else.
INVITE_PERMISSIONS = VIEW_CHANNEL | READ_MESSAGE_HISTORY
# Application flags for the Message Content intent: the full one (verified
# bots) and the toggle on the Bot page (bots in under 100 servers).
MESSAGE_CONTENT_INTENTS = (1 << 18) | (1 << 19)

# Channel types.
TEXT, DM, VOICE, GROUP_DM, CATEGORY, ANNOUNCEMENT = 0, 1, 2, 3, 4, 5
THREAD_TYPES = {10, 11, 12}
STAGE, FORUM, MEDIA = 13, 15, 16
# Channels whose posts are threads; they hold no messages themselves.
POST_CHANNELS = {FORUM, MEDIA}
TYPE_LABELS = {
    VOICE: "voice",
    ANNOUNCEMENT: "announcements",
    STAGE: "stage",
    FORUM: "forum",
    MEDIA: "media",
    12: "private thread",
}

# Message types an author writes; everything else is a system message.
CHAT_TYPES = {0, 19, 20, 23}
SYSTEM_MESSAGES = {
    1: "added someone to the group",
    2: "removed someone from the group",
    3: "started a call",
    4: "changed the channel name",
    5: "changed the channel icon",
    6: "pinned a message",
    7: "joined the server",
    8: "boosted the server",
    9: "boosted the server (level 1)",
    10: "boosted the server (level 2)",
    11: "boosted the server (level 3)",
    12: "followed an announcement channel",
    18: "started a thread",
}
THREAD_STARTER = 21
REPLY = 19
FORWARD = 1  # message_reference.type
IS_CROSSPOST = 1 << 1  # message flags

SNOWFLAKE = re.compile(r"^\d{15,21}$")
LINK = re.compile(
    r"^<?https?://(?:(?:ptb|canary)\.)?discord(?:app)?\.com/channels/(@me|\d+)/(\d+)(?:/(\d+))?/?(?:[?#].*)?>?$"
)
CHANNEL_MENTION = re.compile(r"^<#(\d+)>$")

INTENT_WARNING = (
    "Warning: the bot's Message Content Intent is off, so Discord leaves message text "
    "empty. Turn it on at https://discord.com/developers/applications → the application "
    "→ Bot → Privileged Gateway Intents → Message Content Intent."
)


class Fail(Exception):
    """A problem to report to the caller as is."""


# --- HTTP -------------------------------------------------------------------


class Client:
    def __init__(self, token):
        self.token = token
        self.cache = {}

    def get(self, path, what, **params):
        """GET an API path; `what` names it in errors ("channel 123")."""
        query = {k: v for k, v in params.items() if v not in (None, "")}
        url = API + path
        if query:
            url += "?" + urllib.parse.urlencode(query)
        if url in self.cache:
            return self.cache[url]
        if not self.token:
            raise Fail("The Discord bot token is empty.")
        for attempt in range(5):
            req = urllib.request.Request(
                url,
                headers={
                    "Authorization": "Bot " + self.token,
                    "User-Agent": USER_AGENT,
                    "Accept": "application/json",
                },
            )
            try:
                with urllib.request.urlopen(req, timeout=30) as resp:
                    data = json.load(resp)
                    self.cache[url] = data
                    return data
            except urllib.error.HTTPError as e:
                body = e.read().decode("utf-8", "replace")
                try:
                    data = json.loads(body)
                except ValueError:
                    data = {}
                if not isinstance(data, dict):
                    data = {}
                if e.code == 429 and attempt < 4:
                    wait = data.get("retry_after") or e.headers.get("Retry-After") or 1
                    time.sleep(min(float(wait), 60) + 0.1)
                    continue
                raise Fail(http_error(e.code, data, what))
            except urllib.error.URLError as e:
                raise Fail(f"Could not reach the Discord API at {API}: {e.reason}")
        raise Fail(f"Discord kept rate-limiting the request for {what}; try again shortly.")

    def try_get(self, path, what, **params):
        """get, or None when it fails: for extras that must not sink a result."""
        try:
            return self.get(path, what, **params)
        except Fail:
            return None


def http_error(code, data, what):
    message = data.get("message") or ""
    detail = f" ({code} {message})" if message else f" ({code})"
    if code == 401:
        return (
            "Discord rejected the bot token (401 Unauthorized). Check that the configured "
            "botToken is the bot's current token: resetting it in the Developer Portal "
            "invalidates the old one, and a user account's token does not work here."
        )
    if code == 403:
        return (
            f"The bot is not allowed to read {what}{detail}. Either the bot is not in that "
            "server (discordServers lists the servers it is in, and the link that adds it), "
            "or it lacks the View Channels permission there, plus Read Message History for "
            "past messages: a server admin can grant them to the bot's role, or to the bot "
            "on that channel."
        )
    if code == 404:
        return (
            f"Discord knows no {what} that the bot can see{detail}. Check the id, and that "
            "the bot has been added to its server (discordServers lists the servers it is in)."
        )
    return f"The Discord API request for {what} failed{detail}."


# --- References ---------------------------------------------------------------


def snowflake_time(sid):
    ms = (int(sid) >> 22) + DISCORD_EPOCH_MS
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc)


def time_snowflake(dt):
    ms = int(dt.timestamp() * 1000) - DISCORD_EPOCH_MS
    return str(max(ms, 0) << 22)


def parse_time(value):
    dt = datetime.fromisoformat(value.strip())
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def fmt_time(dt):
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")


def fmt_date(dt):
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%d")


def anchor(value, name):
    """A message id to page from: an id, a message link, or a date/time."""
    v = (value or "").strip()
    if not v:
        return ""
    if SNOWFLAKE.match(v):
        return v
    m = LINK.match(v)
    if m and m.group(3):
        return m.group(3)
    try:
        return time_snowflake(parse_time(v))
    except ValueError:
        pass
    raise Fail(
        f"`{name}` must be a message id, a message link, or a date/time like 2024-05-01 or "
        f"2024-05-01T15:00Z (UTC unless it says otherwise); got {value!r}."
    )


def guilds(c):
    return c.get("/users/@me/guilds", "the bot's servers", with_counts="true")


def server_list(gs):
    return "; ".join(f"{g['name']} (id {g['id']})" for g in gs)


def resolve_server(c, ref):
    """The full guild object for an id, link, name, or the default."""
    ref = (ref or "").strip() or DEFAULT_SERVER
    if not ref:
        gs = guilds(c)
        if len(gs) == 1:
            ref = gs[0]["id"]
        elif not gs:
            raise Fail("The bot is not in any server yet. " + invite_hint(c))
        else:
            raise Fail(
                "The bot is in several servers; pass `server` (an id or name): "
                + server_list(gs)
                + "."
            )
    m = LINK.match(ref)
    if m and m.group(1) != "@me":
        ref = m.group(1)
    if not SNOWFLAKE.match(ref):
        gs = guilds(c)
        named = [g for g in gs if g["name"].casefold() == ref.casefold()]
        if not named:
            raise Fail(f"The bot is in no server named {ref!r}. Its servers: {server_list(gs) or 'none'}.")
        if len(named) > 1:
            raise Fail(f"Several servers are named {ref!r}; pass one by id: {server_list(named)}.")
        ref = named[0]["id"]
    return c.get(f"/guilds/{ref}", f"server {ref}")


def guild_channels(c, gid):
    """A server's channels, and its active threads (which it lists apart)."""
    channels = c.get(f"/guilds/{gid}/channels", "the server's channels")
    active = c.try_get(f"/guilds/{gid}/threads/active", "the server's active threads") or {}
    return channels, active.get("threads") or []


def fetch_channel(c, cid):
    return c.get(f"/channels/{cid}", f"channel {cid}")


def resolve_channel(c, ref, server_ref):
    """(channel, linked message id or "") for an id, link, mention or name."""
    v = (ref or "").strip()
    if not v:
        raise Fail(
            "`channel` is required: a channel or thread id, a link to a channel or message, "
            "or a channel name like #general."
        )
    m = LINK.match(v)
    if m:
        return fetch_channel(c, m.group(2)), m.group(3) or ""
    m = CHANNEL_MENTION.match(v)
    if m:
        v = m.group(1)
    if SNOWFLAKE.match(v):
        return fetch_channel(c, v), ""
    name = v.lstrip("#").strip()
    guild = resolve_server(c, server_ref)
    channels, threads = guild_channels(c, guild["id"])
    named = [
        ch
        for ch in channels + threads
        if ch.get("type") != CATEGORY and (ch.get("name") or "").casefold() == name.casefold()
    ]
    if not named:
        raise Fail(
            f"No channel or active thread named {name!r} in {guild['name']}; "
            "discordChannels lists them."
        )
    if len(named) > 1:
        listed = ", ".join(f"{label(ch)} (id {ch['id']})" for ch in named)
        raise Fail(f"Several channels in {guild['name']} are named {name!r}; pass one by id: {listed}.")
    ch = named[0]
    ch.setdefault("guild_id", guild["id"])
    return ch, ""


def label(ch):
    t = ch.get("type")
    name = ch.get("name") or ""
    if t in THREAD_TYPES:
        return f'thread "{name}"'
    if t == DM:
        return "a direct message"
    if t == GROUP_DM:
        return f'group DM "{name}"' if name else "a group DM"
    return f"#{name}"


def invite_url(app_id):
    return (
        f"https://discord.com/oauth2/authorize?client_id={app_id}"
        f"&scope=bot&permissions={INVITE_PERMISSIONS}"
    )


def invite_hint(c):
    app = c.try_get("/applications/@me", "the bot's application")
    if not app:
        return "Add it to a server from the application's OAuth2 page in the Developer Portal."
    return f"Someone who can manage a server can add it there by opening {invite_url(app['id'])}"


def intent_off(c):
    app = c.try_get("/applications/@me", "the bot's application")
    return app is not None and not (int(app.get("flags") or 0) & MESSAGE_CONTENT_INTENTS)


# --- Permissions --------------------------------------------------------------


def permissions(guild, member, ch):
    """The member's permissions in a channel, per Discord's documented rules."""
    if guild.get("owner_id") == member["user"]["id"]:
        return -1
    roles = {r["id"]: int(r["permissions"]) for r in guild.get("roles") or []}
    gid = guild["id"]
    member_roles = member.get("roles") or []
    perms = roles.get(gid, 0)
    for rid in member_roles:
        perms |= roles.get(rid, 0)
    if perms & ADMINISTRATOR:
        return -1
    overwrites = {o["id"]: o for o in ch.get("permission_overwrites") or []}
    o = overwrites.get(gid)
    if o:
        perms = (perms & ~int(o["deny"])) | int(o["allow"])
    allow = deny = 0
    for rid in member_roles:
        o = overwrites.get(rid)
        if o:
            allow |= int(o["allow"])
            deny |= int(o["deny"])
    perms = (perms & ~deny) | allow
    o = overwrites.get(member["user"]["id"])
    if o:
        perms = (perms & ~int(o["deny"])) | int(o["allow"])
    return perms


def readable_check(c, guild):
    """A channel -> bool predicate, or None when the bot's roles are unknown."""
    me = c.try_get("/users/@me", "the bot's own account")
    if not me:
        return None
    member = c.try_get(f"/guilds/{guild['id']}/members/{me['id']}", "the bot's server membership")
    if not member:
        return None
    member.setdefault("user", me)
    need = VIEW_CHANNEL | READ_MESSAGE_HISTORY
    return lambda ch: permissions(guild, member, ch) & need == need


# --- Rendering ------------------------------------------------------------------


def display(user):
    username = user.get("username") or "unknown"
    name = user.get("global_name")
    if name and name != username:
        return f"{name} (@{username})"
    return f"@{username}"


def short_name(user):
    return user.get("global_name") or user.get("username") or "unknown"


def one_line(text, width=120):
    text = " ".join((text or "").split())
    return text if len(text) <= width else text[: width - 1] + "…"


def indent(text, prefix="  "):
    return "\n".join(prefix + line if line else prefix.rstrip() for line in text.split("\n"))


def size(n):
    n = int(n or 0)
    for unit in ("B", "KB", "MB"):
        if n < 1024:
            return f"{n} {unit}"
        n //= 1024
    return f"{n} GB"


class Names:
    """Names for the ids in message markup, fetched only when they occur."""

    def __init__(self, c, guild_id):
        self.c = c
        self.guild_id = guild_id
        self.users = {}
        self._roles = None
        self._channels = None

    def add_users(self, users):
        for u in users or []:
            if u and u.get("id"):
                self.users.setdefault(u["id"], u)

    def user(self, uid):
        u = self.users.get(uid)
        return "@" + short_name(u) if u else None

    def role(self, rid):
        if self._roles is None:
            roles = self.guild_id and self.c.try_get(f"/guilds/{self.guild_id}/roles", "the server's roles")
            self._roles = {r["id"]: r["name"] for r in roles or []}
        name = self._roles.get(rid)
        return "@" + name if name else None

    def channel(self, cid):
        if self._channels is None:
            self._channels = {}
            if self.guild_id:
                try:
                    channels, threads = guild_channels(self.c, self.guild_id)
                except Fail:
                    channels, threads = [], []
                self._channels = {ch["id"]: ch for ch in channels + threads}
        ch = self._channels.get(cid)
        return label(ch) if ch else None


def render_content(text, names):
    def sub(pattern, lookup, text):
        return re.sub(pattern, lambda m: lookup(m) or m.group(0), text)

    text = sub(r"<@!?(\d+)>", lambda m: names.user(m.group(1)), text)
    text = sub(r"<@&(\d+)>", lambda m: names.role(m.group(1)), text)
    text = sub(r"<#(\d+)>", lambda m: names.channel(m.group(1)), text)
    text = re.sub(r"<a?:(\w+):\d+>", r":\1:", text)
    text = re.sub(r"</([\w -]+):\d+>", r"/\1", text)
    text = sub(r"<t:(-?\d+)(?::[tTdDfFR])?>", lambda m: unix_time(m.group(1)), text)
    return text


def unix_time(seconds):
    """A <t:…> timestamp, or None (keeping the markup) when it is out of range."""
    try:
        return fmt_time(datetime.fromtimestamp(int(seconds), tz=timezone.utc))
    except (ValueError, OverflowError, OSError):
        return None


def render_extras(m, names):
    """Attachment, embed, sticker and poll lines of a message (or snapshot)."""
    lines = []
    for a in m.get("attachments") or []:
        kind = a.get("content_type") or "file"
        lines.append(f"attachment: {a.get('filename')} ({kind}, {size(a.get('size'))}) {a.get('url')}")
    for e in m.get("embeds") or []:
        head = " — ".join(x for x in (e.get("title"), (e.get("author") or {}).get("name")) if x)
        parts = [f"embed: {head or e.get('type') or 'link'}"]
        if e.get("url"):
            parts.append(e["url"])
        lines.append(" ".join(parts))
        if e.get("description"):
            desc = render_content(e["description"], names)
            if len(desc) > 1000:
                desc = desc[:999] + "…"
            lines.append(indent(desc))
        for f in e.get("fields") or []:
            lines.append(indent(f"{f.get('name')}: {render_content(f.get('value') or '', names)}"))
        if (e.get("footer") or {}).get("text"):
            lines.append(indent(e["footer"]["text"]))
    for s in m.get("sticker_items") or []:
        lines.append(f"sticker: {s.get('name')}")
    poll = m.get("poll")
    if poll:
        question = (poll.get("question") or {}).get("text") or ""
        answers = ", ".join((a.get("poll_media") or {}).get("text") or "?" for a in poll.get("answers") or [])
        lines.append(f"poll: {question} — {answers}")
    return lines


def render_message(m, names):
    author = m.get("author") or {}
    head = f"[{fmt_time(snowflake_time(m['id']))}] {display(author)}"
    if author.get("bot"):
        head += " [bot]"
    if m.get("edited_timestamp"):
        head += " (edited)"
    head += f" · id {m['id']}"
    body = []

    t = m.get("type", 0)
    ref = m.get("message_reference") or {}
    replied = m.get("referenced_message")
    if t == THREAD_STARTER:
        if replied:
            body.append(f"(thread started from a message by {display(replied.get('author') or {})}:)")
            body.append(render_content(replied.get("content") or "", names))
            body += render_extras(replied, names)
        else:
            body.append("(thread started from a message that is gone)")
    elif t not in CHAT_TYPES:
        action = SYSTEM_MESSAGES.get(t, f"posted a system message (type {t})")
        text = f"* {short_name(author)} {action}"
        if t == 18 and m.get("content"):
            text += f': "{m["content"]}"'
        body.append(text)
    else:
        if ref.get("type", 0) == FORWARD:
            body.append("(forwarded a message:)")
            for snap in m.get("message_snapshots") or []:
                msg = snap.get("message") or {}
                if msg.get("content"):
                    body.append(indent(render_content(msg["content"], names), "> "))
                body += [indent(x, "> ") for x in render_extras(msg, names)]
        elif t == REPLY:
            if replied:
                who = short_name(replied.get("author") or {})
                snippet = one_line(render_content(replied.get("content") or "", names))
                body.append(f'↪ reply to {who} (id {replied["id"]}): "{snippet}"')
            elif "referenced_message" in m:
                body.append(f"↪ reply to a deleted message (id {ref.get('message_id')})")
            else:
                body.append(f"↪ reply to message {ref.get('message_id')}")
        elif int(m.get("flags") or 0) & IS_CROSSPOST:
            body.append("(crossposted from a followed announcement channel)")
        if m.get("content"):
            body.append(render_content(m["content"], names))
        body += render_extras(m, names)

    thread = m.get("thread")
    if thread:
        count = thread.get("message_count")
        counted = f", {count} messages" if count is not None else ""
        body.append(f'thread: "{thread.get("name")}" (id {thread["id"]}{counted})')
    reactions = m.get("reactions") or []
    if reactions:
        shown = []
        for r in reactions:
            emoji = r.get("emoji") or {}
            name = emoji.get("name") or "?"
            if emoji.get("id"):
                name = f":{name}:"
            shown.append(f"{name} {r.get('count', 0)}")
        body.append("reactions: " + ", ".join(shown))
    if not body:
        body.append("(no text)")
    return "\n".join([head] + [indent(b) for b in body])


def blank(m):
    """A chat message with nothing to show: what a missing intent looks like."""
    return m.get("type", 0) in CHAT_TYPES and not any(
        m.get(k) for k in ("content", "attachments", "embeds", "sticker_items", "poll", "message_snapshots")
    )


def in_server(c, ch):
    gid = ch.get("guild_id")
    guild = gid and c.try_get(f"/guilds/{gid}", f"server {gid}")
    return f" in {guild['name']}" if guild else ""


# --- Commands ---------------------------------------------------------------------


def cmd_servers(c, inp):
    me = c.get("/users/@me", "the bot's own account")
    gs = guilds(c)
    app = c.try_get("/applications/@me", "the bot's application")
    lines = [f"Bot: {display(me)} (user id {me['id']})", ""]
    if gs:
        lines.append(f"Servers the bot is in ({len(gs)}):")
        for g in gs:
            members = g.get("approximate_member_count")
            counted = f", ~{members} members" if members else ""
            lines.append(f"- {g['name']} (id {g['id']}{counted})")
    else:
        lines.append("The bot is not in any server yet.")
    if DEFAULT_SERVER:
        lines.append(f"Configured default server: {DEFAULT_SERVER}")
    if app:
        lines += [
            "",
            "To add the bot to another server, someone who can manage it opens:",
            invite_url(app["id"]),
        ]
        if not (int(app.get("flags") or 0) & MESSAGE_CONTENT_INTENTS):
            lines += ["", INTENT_WARNING]
    return "\n".join(lines)


def channel_sort_key(ch):
    voiceish = ch.get("type") in (VOICE, STAGE)
    return (voiceish, ch.get("position") or 0, int(ch["id"]))


def cmd_channels(c, inp):
    guild = resolve_server(c, inp.get("server"))
    channels, threads = guild_channels(c, guild["id"])
    can_read = readable_check(c, guild)
    by_parent = {}
    for t in threads:
        by_parent.setdefault(t.get("parent_id"), []).append(t)

    def describe(ch, prefix):
        kind = TYPE_LABELS.get(ch.get("type"))
        text = f"{prefix}{label(ch)}" + (f" [{kind}]" if kind else "") + f" (id {ch['id']})"
        notes = []
        if can_read is not None and not can_read(ch):
            notes.append("the bot cannot read this")
        if ch.get("type") in POST_CHANNELS:
            notes.append("posts are threads: discordThreads lists them")
        if ch.get("topic"):
            notes.append(one_line(ch["topic"], 100))
        out = [text + (" — " + "; ".join(notes) if notes else "")]
        kids = sorted(by_parent.get(ch["id"], []), key=lambda t: -int(t.get("last_message_id") or t["id"]))
        for t in kids[:10]:
            count = t.get("message_count")
            counted = f", {count} messages" if count is not None else ""
            out.append(f'{prefix}  thread "{t.get("name")}" (id {t["id"]}{counted})')
        if len(kids) > 10:
            out.append(f"{prefix}  … and {len(kids) - 10} more active threads: discordThreads lists them")
        return out

    categories = sorted((ch for ch in channels if ch.get("type") == CATEGORY), key=channel_sort_key)
    top = sorted(
        (ch for ch in channels if ch.get("type") != CATEGORY and not ch.get("parent_id")), key=channel_sort_key
    )
    lines = [f"Channels in {guild['name']} (server id {guild['id']}):", ""]
    for ch in top:
        lines += describe(ch, "")
    known = {cat["id"] for cat in categories}
    for cat in categories:
        kids = sorted((ch for ch in channels if ch.get("parent_id") == cat["id"]), key=channel_sort_key)
        lines.append(f"{cat.get('name')}:")
        for ch in kids:
            lines += describe(ch, "  ")
    # Channels under a category the bot was not shown.
    for ch in sorted(
        (ch for ch in channels if ch.get("parent_id") and ch.get("type") != CATEGORY and ch["parent_id"] not in known),
        key=channel_sort_key,
    ):
        lines += describe(ch, "")
    if can_read is None:
        lines += ["", "(Could not work out the bot's permissions, so unreadable channels are not marked.)"]
    return "\n".join(lines)


def cmd_messages(c, inp):
    ch, linked = resolve_channel(c, inp.get("channel"), inp.get("server"))
    where = label(ch)
    if ch.get("type") == CATEGORY:
        raise Fail(f"{where} is a category, which holds channels rather than messages.")
    if ch.get("type") in POST_CHANNELS:
        raise Fail(
            f"{where} is a forum: its posts are threads. List them with "
            f'discordThreads(channel: "{ch["id"]}"), then read one by its id.'
        )
    limit = inp.get("limit")
    limit = 50 if limit is None else int(limit)
    if not 1 <= limit <= 100:
        raise Fail(f"`limit` must be between 1 and 100; got {limit}.")
    anchors = {k: anchor(inp.get(k), k) for k in ("before", "after", "around")}
    given = [k for k, v in anchors.items() if v]
    if len(given) > 1:
        raise Fail("Pass only one of `before`, `after` and `around`.")
    if not given and linked:
        anchors["around"] = linked
        given = ["around"]
    mode = given[0] if given else "latest"

    msgs = c.get(f"/channels/{ch['id']}/messages", f"the messages in {where}", limit=limit, **anchors)
    msgs.sort(key=lambda m: int(m["id"]))

    names = Names(c, ch.get("guild_id"))
    for m in msgs:
        names.add_users([m.get("author")] + (m.get("mentions") or []))
        replied = m.get("referenced_message")
        if replied:
            names.add_users([replied.get("author")] + (replied.get("mentions") or []))

    if ch.get("type") in THREAD_TYPES and ch.get("parent_id"):
        parent = c.try_get(f"/channels/{ch['parent_id']}", "the thread's channel")
        if parent:
            where += f" in {label(parent)}"
    where += in_server(c, ch)
    header = f"{where} (channel id {ch['id']})"

    if not msgs:
        empty = {
            "latest": "No messages yet.",
            "before": "No messages before that: this is the beginning of the channel.",
            "after": "No messages after that yet.",
            "around": "No messages there.",
        }[mode]
        return f"{header}\n\n{empty}"

    lines = [f"{header}: {len(msgs)} messages, oldest first", ""]
    lines += [render_message(m, names) + "\n" for m in msgs]
    older = mode in ("after", "around") or len(msgs) == limit
    newer = mode in ("before", "around") or (mode == "after" and len(msgs) == limit)
    if older:
        lines.append(f'Older: discordMessages(channel: "{ch["id"]}", before: "{msgs[0]["id"]}")')
    else:
        lines.append("(This is the beginning of the channel.)")
    if newer:
        lines.append(f'Newer: discordMessages(channel: "{ch["id"]}", after: "{msgs[-1]["id"]}")')
    elif mode == "latest" or mode == "after":
        lines.append("(These are the latest messages.)")
    if any(blank(m) for m in msgs) and intent_off(c):
        lines += ["", INTENT_WARNING]
    return "\n".join(lines)


def cmd_threads(c, inp):
    ch, _ = resolve_channel(c, inp.get("channel"), inp.get("server"))
    where = label(ch)
    if ch.get("type") in THREAD_TYPES:
        raise Fail(f'{where} is a thread itself: read it with discordMessages(channel: "{ch["id"]}").')
    before = (inp.get("before") or "").strip()
    if before:
        try:
            before = (snowflake_time(before) if SNOWFLAKE.match(before) else parse_time(before)).isoformat()
        except ValueError:
            raise Fail(f"`before` must be a date/time like 2024-05-01 or 2024-05-01T15:00Z; got {before!r}.")

    tags = {t["id"]: t.get("name") for t in ch.get("available_tags") or []}
    active = []
    if not before and ch.get("guild_id"):
        _, threads = guild_channels(c, ch["guild_id"])
        active = [t for t in threads if t.get("parent_id") == ch["id"]]
    archived = c.get(
        f"/channels/{ch['id']}/threads/archived/public",
        f"the archived threads of {where}",
        limit=50,
        before=before,
    )
    old = archived.get("threads") or []

    def describe(t):
        meta = t.get("thread_metadata") or {}
        facts = [f"id {t['id']}"]
        if t.get("message_count") is not None:
            facts.append(f"{t['message_count']} messages")
        facts.append(f"started {fmt_date(snowflake_time(t['id']))}")
        if t.get("last_message_id"):
            facts.append(f"last message {fmt_date(snowflake_time(t['last_message_id']))}")
        if meta.get("locked"):
            facts.append("locked")
        text = f'- "{t.get("name")}" ({", ".join(facts)})'
        applied = [tags.get(tid) for tid in t.get("applied_tags") or [] if tags.get(tid)]
        if applied:
            text += " [" + ", ".join(applied) + "]"
        return text

    lines = [f"Threads in {where}{in_server(c, ch)} (channel id {ch['id']}):"]
    if not before:
        lines += ["", f"Active ({len(active)}):"]
        lines += [describe(t) for t in sorted(active, key=lambda t: -int(t.get("last_message_id") or t["id"]))]
        if not active:
            lines.append("(none)")
    lines += ["", f"Archived ({len(old)}{'+' if archived.get('has_more') else ''}):"]
    lines += [describe(t) for t in old]
    if not old:
        lines.append("(none)")
    if archived.get("has_more") and old:
        last = (old[-1].get("thread_metadata") or {}).get("archive_timestamp")
        if last:
            lines += ["", f'Older archived threads: discordThreads(channel: "{ch["id"]}", before: "{last}")']
    lines += ["", 'Read one with discordMessages(channel: "<thread id>").']
    return "\n".join(lines)


COMMANDS = {
    "servers": cmd_servers,
    "channels": cmd_channels,
    "messages": cmd_messages,
    "threads": cmd_threads,
}


def main():
    command, path = sys.argv[1], sys.argv[2]
    with open(path) as f:
        inp = json.load(f)
    token = os.environ.get("DISCORD_TOKEN", "").strip()
    # Tolerate a token pasted with its header scheme.
    if token[:4].lower() == "bot ":
        token = token[4:].strip()
    try:
        out = COMMANDS[command](Client(token), inp)
    except Fail as e:
        print(str(e), file=sys.stderr)
        sys.exit(FAIL_EXIT)
    sys.stdout.write(out.rstrip("\n") + "\n")


if __name__ == "__main__":
    main()
