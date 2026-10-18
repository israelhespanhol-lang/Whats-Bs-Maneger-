/** Pure validators: outgoing messages have exactly one human destination. */
export function normalizeRecipient(input) {
  if (typeof input !== "string") throw new Error("Destino ausente");
  const digits = input.trim().replace(/^\+/, "");
  if (!/^[1-9][0-9]{7,14}$/.test(digits)) throw new Error("Telefone E.164 inválido");
  return digits;
}

export function formatManualReply(agent, text) {
  if (typeof agent !== "string" || typeof text !== "string") {
    throw new Error("Nome do atendente e mensagem são obrigatórios");
  }
  const name = agent.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  const body = text.trim();
  if (!name || name.length > 80) throw new Error("Nome do atendente inválido");
  if (!body) throw new Error("A mensagem não pode ser vazia");
  const prefix = name + ":";
  const signed = body.startsWith(prefix) ? body : prefix + "\n" + body;
  if (signed.length > 4096) throw new Error("Mensagem com assinatura excede 4096 caracteres");
  return signed;
}

export function safeMessageText(message) {
  const m = message?.message;
  const text = m?.conversation ?? m?.extendedTextMessage?.text ??
    m?.imageMessage?.caption ?? m?.documentMessage?.caption ?? null;
  return typeof text === "string" ? text.slice(0, 4096) : null;
}
