# Input/ - task entry (SHARED)
Drop task envelopes here as T-*.json (see docs/BRIDGE-SPEC.md for the schema).
Both containers read/write this directory; use atomic .tmp -> rename writes.
Example envelope:

{ "schema":"odsh-envelope/v1", "taskId":"T-000101-01", "type":"execute", "status":"queued", "requester":"human", "target":"dsh", "payload":{ "kind":"echo", "text":"hello" } }

Publish immutable envelopes with a unique ASCII task ID matching the filename; result IDs are unique under ASCII case folding. DSH consumes target=dsh, both or omitted. Optional expiresMs is a finite absolute Unix-millisecond deadline, distinct from renewable lease TTL. Input/.state holds required SQLite authority and its marker. See the [bridge specification](../../docs/BRIDGE-SPEC.md) and [lease guide](../../docs/LEASES.md) in the source checkout.
