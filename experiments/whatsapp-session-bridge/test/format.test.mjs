import test from "node:test";
import assert from "node:assert/strict";
import { normalizeRecipient, formatManualReply, safeMessageText } from "../src/format.mjs";

test("normaliza um único destinatário em formato internacional", () => {
  assert.equal(normalizeRecipient("+5548999998888"), "5548999998888");
  assert.throws(() => normalizeRecipient("5548999,5548777"));
  assert.throws(() => normalizeRecipient("0"));
});

test("identifica atendente no conteúdo que o cliente receberia", () => {
  assert.equal(formatManualReply("Israel Hespanhol", "Olá, tudo bem?"),
    "Israel Hespanhol:\nOlá, tudo bem?");
});

test("não duplica a assinatura nem admite mensagens em branco", () => {
  assert.equal(formatManualReply("Israel Hespanhol", "Israel Hespanhol:\nOlá"),
    "Israel Hespanhol:\nOlá");
  assert.throws(() => formatManualReply("Israel", " "));
  assert.throws(() => formatManualReply("Israel", "x".repeat(4096)));
});

test("extrai somente campos de texto comuns", () => {
  assert.equal(safeMessageText({ message: { extendedTextMessage: { text: "Ok" } } }), "Ok");
  assert.equal(safeMessageText({ message: { audioMessage: {} } }), null);
});
