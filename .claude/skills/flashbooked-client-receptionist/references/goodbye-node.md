# Getting the agent to actually say goodbye and hang up

Two independent bugs stack here. Both need fixing or the call either never says goodbye, or says
it and then never actually ends.

## Bug 1: `type: "end"` nodes don't speak

A conversation-flow node with `"type": "end"` hangs up the instant it's entered, regardless of
what its `instruction` field says. Confirmed by pulling a real call's `transcript_with_tool_calls`
and finding the `node_transition` into the end node and the `end_call` tool invocation timestamped
within 0.001 seconds of each other — no time existed for any TTS to generate.

**Fix:** never point an edge directly at a `type: "end"` node from anywhere that needs a final
spoken line first. Insert a `type: "conversation"` node in between whose only job is to say the
line, and have that node's own edge go to the (silent) end node.

## Bug 2: a `conversation` node waits for a reply before advancing

Once the goodbye line is moved into a proper conversation node, it gets spoken correctly — but
then nothing happens. A `conversation` node's default behavior is: speak, then wait for the
caller to reply, then evaluate its outgoing edges. The caller, having just heard "bye," doesn't
say anything else — so the node never re-evaluates, and the call just sits open until a ~10s
silence-reminder fires (repeating the goodbye) or the caller manually hangs up.

**Fix:** set `skip_response_edge` on the goodbye node. This makes it speak its line and transition
immediately, without waiting for a reply. It replaces the node's normal `edges` array entirely —
clear `edges` to `[]` once `skip_response_edge` is set, since the skip edge is what actually fires.

## Exact working node + edge shape

```json
{
  "id": "goodbye-node",
  "type": "conversation",
  "name": "Goodbye",
  "display_position": {"x": 750, "y": 380},
  "instruction": {
    "type": "prompt",
    "text": "Say the actual goodbye now, out loud — this is the only place it happens, the node after this one cannot speak. Follow the End Of Call section: one short confirmation if relevant, then a goodbye word like \"bye\", \"bye now\", or \"talk soon\" as the literal last words. Keep it to one short sentence total. Do not ask any questions here."
  },
  "edges": [],
  "skip_response_edge": {
    "id": "edge-goodbye-skip-to-end",
    "destination_node_id": "end-call-node",
    "transition_condition": {
      "type": "prompt",
      "prompt": "Skip response"
    }
  }
}
```

**The `transition_condition.prompt` value must be the literal string `"Skip response"`.** This
isn't a placeholder — it's a fixed marker Retell's API schema validates against. Anything else gets
rejected with `must be equal to one of the allowed values: Skip response`, which is also how this
requirement was actually discovered (the API's own validation error told us the exact required
value — worth reading `update-conversation-flow` error bodies carefully, they're more informative
than the docs).

## Wiring it into an existing flow

Redirect every edge across the whole flow that currently points at the terminal end node so it
points at `goodbye-node` instead — not just the "success" path. Any path that can end the call
(a clean resolution with nothing to capture, an urgent escalation, whatever else exists in a
given client's flow) needs to go through the goodbye node too, or that specific path will silently
regress back to bug 1.
