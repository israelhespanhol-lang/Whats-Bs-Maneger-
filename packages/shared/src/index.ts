export type ConversationStatus = "OPEN" | "WAITING" | "RESOLVED";

export type ContactStatus =
  | "LEAD"
  | "INTERESTED"
  | "NEGOTIATION"
  | "CUSTOMER"
  | "NOT_INTERESTED";

export type MessageDirection = "INBOUND" | "OUTBOUND";

export type WhatsAppMessageStatus =
  | "PENDING"
  | "SENT"
  | "DELIVERED"
  | "READ"
  | "FAILED";

export type WhatsAppAccountStatus =
  | "DISCONNECTED"
  | "CONNECTING"
  | "CONNECTED"
  | "ERROR";

export interface ContactSummary {
  id: string;
  name: string | null;
  phone: string;
  status?: ContactStatus;
  avatarUrl?: string | null;
}

export interface ConversationSummary {
  id: string;
  contact: ContactSummary;
  status: ConversationStatus;
  unreadCount: number;
  lastMessageAt: string | null;
  lastMessageBody?: string | null;
  lastMessageDirection?: MessageDirection | null;
  windowExpiresAt?: string | null;
  assigneeName?: string | null;
}

export interface MessageSummary {
  id: string;
  whatsappMessageId: string | null;
  direction: MessageDirection;
  messageType: string;
  body: string | null;
  mediaUrl: string | null;
  status: WhatsAppMessageStatus;
  createdAt: string;
  sentAt: string | null;
  deliveredAt: string | null;
  readAt: string | null;
}
