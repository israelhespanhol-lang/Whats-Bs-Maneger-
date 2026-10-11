"use client";

import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import styles from "./business-photo-editor.module.css";

type Dimensions = { width: number; height: number };
type Offset = { x: number; y: number };

type Props = {
  file: File;
  onCancel: () => void;
  onConfirm: (cropped: File) => void;
};

const OUTPUT_SIZE = 640;
const MAX_ZOOM = 3;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

export default function BusinessPhotoEditor({ file, onCancel, onConfirm }: Props) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [dimensions, setDimensions] = useState<Dimensions | null>(null);
  const [viewportSize, setViewportSize] = useState(320);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState<Offset>({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const dragRef = useRef<{ x: number; y: number; offset: Offset } | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setImageUrl(url);
    setDimensions(null);
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    setError(null);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onCancel]);

  useEffect(() => {
    if (!viewportRef.current) return;
    const element = viewportRef.current;
    const observer = new ResizeObserver(() => {
      setViewportSize(element.getBoundingClientRect().width || 320);
    });
    observer.observe(element);
    setViewportSize(element.getBoundingClientRect().width || 320);
    return () => observer.disconnect();
  }, []);

  const baseScale = dimensions
    ? Math.max(viewportSize / dimensions.width, viewportSize / dimensions.height)
    : 1;
  const imageWidth = dimensions ? dimensions.width * baseScale * zoom : 0;
  const imageHeight = dimensions ? dimensions.height * baseScale * zoom : 0;
  const maxX = Math.max(0, (imageWidth - viewportSize) / 2);
  const maxY = Math.max(0, (imageHeight - viewportSize) / 2);

  useEffect(() => {
    setOffset((current) => ({
      x: clamp(current.x, -maxX, maxX),
      y: clamp(current.y, -maxY, maxY)
    }));
  }, [maxX, maxY]);

  function updateZoom(value: number) {
    const next = clamp(value, 1, MAX_ZOOM);
    const ratio = next / zoom;
    const nextWidth = dimensions ? dimensions.width * baseScale * next : 0;
    const nextHeight = dimensions ? dimensions.height * baseScale * next : 0;
    const nextMaxX = Math.max(0, (nextWidth - viewportSize) / 2);
    const nextMaxY = Math.max(0, (nextHeight - viewportSize) / 2);
    setOffset((current) => ({
      x: clamp(current.x * ratio, -nextMaxX, nextMaxX),
      y: clamp(current.y * ratio, -nextMaxY, nextMaxY)
    }));
    setZoom(next);
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!dimensions || busy) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { x: event.clientX, y: event.clientY, offset: { ...offset } };
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    event.preventDefault();
    setOffset({
      x: clamp(drag.offset.x + event.clientX - drag.x, -maxX, maxX),
      y: clamp(drag.offset.y + event.clientY - drag.y, -maxY, maxY)
    });
  }

  function endDrag(event: ReactPointerEvent<HTMLDivElement>) {
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function onPreviewKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const move = 12;
    const x = event.key === "ArrowLeft" ? -move : event.key === "ArrowRight" ? move : 0;
    const y = event.key === "ArrowUp" ? -move : event.key === "ArrowDown" ? move : 0;
    if (!x && !y) return;
    event.preventDefault();
    setOffset((current) => ({
      x: clamp(current.x + x, -maxX, maxX),
      y: clamp(current.y + y, -maxY, maxY)
    }));
  }

  async function confirmCrop() {
    if (!dimensions || !imageRef.current || busy) return;
    setBusy(true);
    setError(null);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = OUTPUT_SIZE;
      canvas.height = OUTPUT_SIZE;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Seu navegador não conseguiu preparar a foto.");

      const factor = OUTPUT_SIZE / viewportSize;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(
        imageRef.current,
        ((viewportSize - imageWidth) / 2 + offset.x) * factor,
        ((viewportSize - imageHeight) / 2 + offset.y) * factor,
        imageWidth * factor,
        imageHeight * factor
      );
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (result) => result ? resolve(result) : reject(new Error("Não foi possível gerar a foto.")),
          "image/jpeg",
          0.92
        );
      });
      onConfirm(new File([blob], "foto-perfil-comercial.jpg", {
        type: "image/jpeg",
        lastModified: Date.now()
      }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível recortar a foto.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.backdrop}>
      <section className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="business-photo-editor-title">
        <header className={styles.header}>
          <div>
            <span className={styles.eyebrow}>Foto pública do WhatsApp</span>
            <h2 id="business-photo-editor-title">Ajustar foto comercial</h2>
            <p>Arraste para centralizar a imagem e use o zoom para definir o enquadramento.</p>
          </div>
          <button type="button" className={styles.close} onClick={onCancel} aria-label="Fechar editor" disabled={busy}>×</button>
        </header>

        <div className={styles.editorArea}>
          <div
            ref={viewportRef}
            className={styles.viewport}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onKeyDown={onPreviewKeyDown}
            tabIndex={0}
            aria-label="Prévia da foto. Arraste ou use as setas para reposicionar."
          >
            {imageUrl && (
              <img
                ref={imageRef}
                src={imageUrl}
                alt=""
                draggable={false}
                className={styles.image}
                style={dimensions ? {
                  width: imageWidth,
                  height: imageHeight,
                  left: (viewportSize - imageWidth) / 2 + offset.x,
                  top: (viewportSize - imageHeight) / 2 + offset.y
                } : { opacity: 0 }}
                onLoad={(event) => {
                  const image = event.currentTarget;
                  if (image.naturalWidth && image.naturalHeight) {
                    setDimensions({ width: image.naturalWidth, height: image.naturalHeight });
                  } else {
                    setError("Esta imagem não pôde ser carregada.");
                  }
                }}
                onError={() => setError("Não foi possível abrir essa imagem. Escolha outra foto.")}
              />
            )}
            <div className={styles.circleGuide} aria-hidden="true" />
            <div className={styles.dragHint} aria-hidden="true">Arraste para mover</div>
          </div>
          <div className={styles.previewCaption}>A área dentro do círculo simula como a foto ficará visível aos clientes. O arquivo será salvo quadrado.</div>
        </div>

        <div className={styles.controls}>
          <div className={styles.zoomTitle}>
            <label htmlFor="business-photo-zoom">Zoom</label>
            <span>{Math.round(zoom * 100)}%</span>
          </div>
          <div className={styles.zoomRow}>
            <button type="button" className={styles.zoomButton} onClick={() => updateZoom(zoom - 0.1)} aria-label="Diminuir zoom" disabled={busy || !dimensions || zoom <= 1}>−</button>
            <input
              id="business-photo-zoom"
              type="range"
              min="100"
              max="300"
              step="1"
              value={Math.round(zoom * 100)}
              onChange={(event) => updateZoom(Number(event.target.value) / 100)}
              disabled={busy || !dimensions}
              aria-label="Ajustar zoom da foto"
            />
            <button type="button" className={styles.zoomButton} onClick={() => updateZoom(zoom + 0.1)} aria-label="Aumentar zoom" disabled={busy || !dimensions || zoom >= MAX_ZOOM}>+</button>
          </div>
          <button type="button" className={styles.resetButton} onClick={() => { setZoom(1); setOffset({ x: 0, y: 0 }); }} disabled={busy || !dimensions}>
            Restaurar enquadramento
          </button>
        </div>

        {error && <p className={styles.error} role="alert">{error}</p>}

        <footer className={styles.footer}>
          <span>Saída: JPG 640 × 640</span>
          <div className={styles.actions}>
            <button type="button" className={styles.cancel} onClick={onCancel} disabled={busy}>Cancelar</button>
            <button type="button" className={styles.confirm} onClick={() => void confirmCrop()} disabled={busy || !dimensions || !!error}>
              {busy ? "Preparando imagem..." : "Confirmar enquadramento"}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
