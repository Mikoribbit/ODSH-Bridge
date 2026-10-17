# Output/ - result exit (SHARED)
Results land here as <taskId>_result.json (written atomically by the daemon).
Both containers may read; name files <timestamp>_<taskId>_<type>.<ext> to avoid collision.

Result JSON is a recoverable projection of committed SQLite authority. needs-review means uncertain effects require reconciliation. Retain task/result JSON and state during cleanup; back up the full bridge with consumers stopped.
