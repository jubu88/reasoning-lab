// Quick cross-model referee test: does deepseek-r1 solve the widow riddle?
// Streaming avoids the undici headers timeout while the model loads/thinks.

const widow =
  "Is it possible for a living man to marry his widow's sister? Answer yes or no, then explain briefly.\n\nEnd your response with exactly one line:\nFINAL: <your answer>";

const res = await fetch("http://localhost:11434/api/chat", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    model: "deepseek-r1:latest",
    messages: [{ role: "user", content: widow }],
    stream: true,
    keep_alive: "5m",
    options: { temperature: 0, seed: 7, num_predict: 4096 },
  }),
});
if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);

const reader = res.body.getReader();
const dec = new TextDecoder();
let buf = "", content = "", thinking = "";
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  buf += dec.decode(value, { stream: true });
  const lines = buf.split("\n");
  buf = lines.pop() ?? "";
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const c = JSON.parse(line);
      content += c.message?.content ?? "";
      thinking += c.message?.thinking ?? "";
    } catch {}
  }
}
console.log("thinking chars:", thinking.length);
console.log("thinking tail:", JSON.stringify(thinking.slice(-300)));
console.log("\n=== ANSWER ===\n" + content);
