"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";

type Props = {
  messageId: string;
  kind: string;
  label?: string | null;
};

export default function MessageMedia({ messageId, kind, label }: Props) {
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [mediaType, setMediaType] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const urlRef = useRef<string | null>(null);

  useEffect(() => () => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
  }, []);

  async function loadMedia() {
    if (loading || mediaUrl) return;
    setLoading(true);
    setError(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const session = sessionData.session;
      if (!session) throw new Error("Entre novamente para acessar o arquivo.");
      const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
      if (!base) throw new Error("Serviço de arquivos indisponível.");
      const response = await fetch(base + "/functions/v1/whatsapp-media-view", {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + session.access_token,
          "apikey": process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ messageId })
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Não foi possível recuperar a mídia da Meta.");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = url;
      setMediaUrl(url);
      setMediaType(blob.type);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao abrir mídia.");
    } finally {
      setLoading(false);
    }
  }

  const type = kind === "sticker" ? "image" : kind;
  const extension = mediaType.includes("pdf") ? ".pdf"
    : mediaType.includes("mpeg") ? ".mp3"
    : mediaType.includes("ogg") ? ".ogg"
    : mediaType.includes("mp4") ? ".mp4"
    : mediaType.includes("png") ? ".png"
    : mediaType.includes("webp") ? ".webp"
    : ".jpg";
  const downloadName = "mais-chat-" + type + "-" + messageId.slice(0, 8) + extension;

  return (
    <div className="chatMediaAttachment">
      {!mediaUrl ? (
        <button type="button" className="chatMediaLoad" onClick={() => void loadMedia()} disabled={loading}>
          {loading ? "Carregando arquivo..." : type === "image" ? "▧ Visualizar imagem" :
            type === "audio" ? "▶ Ouvir áudio" : type === "video" ? "▶ Ver vídeo" : "↓ Abrir documento"}
        </button>
      ) : (
        <>
          {type === "image" && (
            <button type="button" className="chatMediaOpen" onClick={() => setExpanded(true)}
              aria-label="Ampliar imagem">
              {/* Preview from authenticated, locally-scoped Blob URL, never from Meta directly. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="chatMediaImage" src={mediaUrl} alt={label || "Imagem da conversa"} />
            </button>
          )}
          {type === "audio" && <audio controls preload="metadata" src={mediaUrl} className="chatMediaAudio" />}
          {type === "video" && <video controls preload="metadata" src={mediaUrl} className="chatMediaVideo" />}
          {type === "document" && <span className="chatMediaDocument">▤ {label || "Documento recebido"}</span>}
          <a className="chatMediaDownload" href={mediaUrl} download={downloadName}>↓ Baixar arquivo</a>
        </>
      )}
      {error && <span className="chatMediaError" role="alert">{error}</span>}
      {expanded && mediaUrl && (
        <div className="chatMediaOverlay" role="dialog" aria-modal="true" aria-label="Imagem ampliada">
          <button type="button" aria-label="Fechar imagem" className="chatMediaOverlayClose" onClick={() => setExpanded(false)}>×</button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={mediaUrl} alt={label || "Imagem ampliada"} />
        </div>
      )}
    </div>
  );
}
