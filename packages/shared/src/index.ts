export type ConversationStatus = "OPEN" | "WAITING" | "RESOLVED";

export type MessageDirection = "INBOUND" | "OUTBOUND";

export type WhatsAppMessageStatus =
  | "PENDING"
  | "SENT"
  | "DELIVERED"
  | "READ"
  | "FAILED";

export interface ContactSummary {
  id: string;
  name: string | null;
  phone: string;
}

export interface ConversationSummary {
  id: string;
  contact: ContactSummary;
  status: ConversationStatus;
  unreadCount: number;
  lastMessageAt: string;
}
