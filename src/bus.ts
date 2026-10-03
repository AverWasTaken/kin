import { EventEmitter } from "node:events";
import { json, now, parse, type Store } from "./db.js";
import type { StreamEvent } from "./shared/api.js";

type EventType = StreamEvent["type"];
type DataOf<T extends EventType> = Extract<StreamEvent, { type: T }>["data"];

// Ephemeral events (agent.state) are broadcast but not stored, so a reconnect never replays stale typing states.
const EPHEMERAL = new Set<EventType>(["agent.state"]);
const KEEP = 5000;

export class Bus extends EventEmitter {
  private ephemeralSeq = 0;
  constructor(readonly store: Store) {
    super();
    this.setMaxListeners(200);
  }
  publish<T extends EventType>(type: T, data: DataOf<T>) {
    let seq: number;
    if (EPHEMERAL.has(type)) seq = this.ephemeralSeq || this.lastSeq();
    else {
      seq = Number(this.store.run("INSERT INTO events(type,data,created_at) VALUES(?,?,?)", type, json(data), now()).lastInsertRowid);
      this.ephemeralSeq = seq;
      if (seq % 500 === 0) this.store.run("DELETE FROM events WHERE seq<?", seq - KEEP);
    }
    const event = { seq, type, data } as StreamEvent;
    this.emit("event", event);
    return event;
  }
  lastSeq() {
    return this.store.get<{ s: number }>("SELECT COALESCE(MAX(seq),0) AS s FROM events")!.s;
  }
  /** Events after `since`, or null when the cursor is older than retained history (client must refetch). */
  since(since: number): StreamEvent[] | null {
    const first = this.store.get<{ s: number }>("SELECT MIN(seq) AS s FROM events")?.s;
    if (first != null && since < first - 1) return null;
    const rows = this.store.all<{ seq: number; type: EventType; data: string }>(
      "SELECT seq,type,data FROM events WHERE seq>? ORDER BY seq LIMIT 2001",
      since,
    );
    // Too far behind to replay in one go: make the client refetch instead of silently missing events.
    if (rows.length > 2000) return null;
    return rows.map((r) => ({ seq: r.seq, type: r.type, data: parse(r.data, {}) }) as StreamEvent);
  }
}
