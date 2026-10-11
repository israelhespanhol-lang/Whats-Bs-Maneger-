// Standalone synthetic benchmark. Does not use real contacts or send WhatsApp messages.
import { performance } from "node:perf_hooks";
import assert from "node:assert/strict";

const total = 10000;
const data = Array.from({ length: total }, (_, i) => ({
  id: "test-" + i,
  last_message_at: new Date(Date.now() - (i * 73137) % 10000000).toISOString(),
  unread_count: i % 7 === 0 ? 1 : 0,
  name: "Contato fictício " + i
}));

const start = performance.now();
const filtered = data.filter((item) => item.unread_count > 0);
const sorted = [...filtered].sort((a, b) =>
  Date.parse(b.last_message_at) - Date.parse(a.last_message_at)
);
const elapsed = performance.now() - start;

assert.equal(filtered.length, Math.ceil(total / 7));
assert.equal(sorted.length, filtered.length);
for (let i = 1; i < sorted.length; i++) {
  assert.ok(sorted[i - 1].last_message_at >= sorted[i].last_message_at);
}
console.log("Inbox data benchmark: " + total + " fake conversations; " + filtered.length + " unread; " + elapsed.toFixed(1) + "ms");
assert.ok(elapsed < 2500, "Synthetic filtering/sorting took more than 2.5 seconds");
