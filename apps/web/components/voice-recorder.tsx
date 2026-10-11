"use client";

import { useEffect, useRef, useState } from "react";

const RECORDING_LIMIT_SECONDS = 120;

type Props = {
  disabled?: boolean;
  onReady: (file: File) => void;
  onError: (error: string) => void;
};

async function convertToMp3(blob: Blob) {
  const context = new AudioContext();
  let decoded: AudioBuffer;
  try {
    decoded = await context.decodeAudioData(await blob.arrayBuffer());
  } finally {
    await context.close();
  }
  if (decoded.duration <= 0.4) throw new Error("A gravação ficou muito curta.");
  if (decoded.duration > RECORDING_LIMIT_SECONDS + 3) throw new Error("A gravação excedeu dois minutos.");

  // Convert browser-only WebM/MP4 recorder formats into MP3 supported by Meta.
  const sampleRate = 44100;
  const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * sampleRate), sampleRate);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start(0);
  const mono = await offline.startRendering();
  const audio = mono.getChannelData(0);
  const lame = await import("@breezystack/lamejs");
  const encoder = new lame.Mp3Encoder(1, sampleRate, 64);
  const chunks: ArrayBuffer[] = [];

  for (let offset = 0; offset < audio.length; offset += 1152) {
    const frame = audio.subarray(offset, Math.min(offset + 1152, audio.length));
    const int16 = new Int16Array(frame.length);
    for (let i = 0; i < frame.length; i++) {
      const sample = Math.max(-1, Math.min(1, frame[i]));
      int16[i] = Math.round(sample * 32767);
    }
    const encoded = encoder.encodeBuffer(int16);
    if (encoded.length) chunks.push(Uint8Array.from(encoded).buffer);
  }
  const finalChunk = encoder.flush();
  if (finalChunk.length) chunks.push(Uint8Array.from(finalChunk).buffer);
  const output = new Blob(chunks, { type: "audio/mpeg" });
  if (!output.size || output.size > 12 * 1024 * 1024) {
    throw new Error("O áudio não pôde ser preparado para o WhatsApp.");
  }
  return new File([output], "audio-mais-chat.mp3", { type: "audio/mpeg" });
}

export default function VoiceRecorder({ disabled, onReady, onError }: Props) {
  const [state, setState] = useState<"idle" | "recording" | "converting">("idle");
  const [seconds, setSeconds] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const startingRef = useRef(false);

  function stopTracks() {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    intervalRef.current = null;
    timeoutRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (recorderRef.current?.state === "recording") recorderRef.current.stop();
      stopTracks();
    };
  }, []);

  async function start() {
    if (disabled || startingRef.current || state !== "idle") return;
    startingRef.current = true;
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
        throw new Error("Seu navegador não oferece gravação de microfone.");
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mountedRef.current) { stream.getTracks().forEach((track) => track.stop()); return; }
      streamRef.current = stream;
      const mime = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus"]
        .find((format) => typeof MediaRecorder.isTypeSupported === "function" && MediaRecorder.isTypeSupported(format));
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      recorderRef.current = recorder;
      const chunks: Blob[] = [];
      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      });
      recorder.addEventListener("error", () => {
        stopTracks();
        if (mountedRef.current) {
          setState("idle");
          onError("O navegador interrompeu a gravação. Tente novamente.");
        }
      });
      recorder.addEventListener("stop", () => {
        stopTracks();
        if (!mountedRef.current) return;
        setState("converting");
        void convertToMp3(new Blob(chunks, { type: recorder.mimeType || "audio/webm" }))
          .then((file) => { if (mountedRef.current) onReady(file); })
          .catch((cause) => { if (mountedRef.current) onError(cause instanceof Error ? cause.message : "Não foi possível converter o áudio."); })
          .finally(() => { if (mountedRef.current) setState("idle"); });
      });
      recorder.start();
      setSeconds(0);
      setState("recording");
      const startTime = Date.now();
      intervalRef.current = setInterval(() => {
        if (mountedRef.current) setSeconds(Math.floor((Date.now() - startTime) / 1000));
      }, 500);
      timeoutRef.current = setTimeout(() => {
        if (recorder.state === "recording") recorder.stop();
      }, RECORDING_LIMIT_SECONDS * 1000);
    } catch (cause) {
      stopTracks();
      if (mountedRef.current) {
        onError(cause instanceof Error ? cause.message : "Sem permissão para usar o microfone.");
        setState("idle");
      }
    } finally {
      startingRef.current = false;
    }
  }

  return (
    <button type="button" className={"voiceRecordButton" + (state === "recording" ? " isRecording" : "")}
      disabled={disabled || state === "converting"} aria-label={state === "recording" ? "Parar gravação" : "Gravar áudio"}
      title="Gravar áudio para revisão antes de enviar"
      onClick={() => {
        if (state === "recording") {
          if (recorderRef.current?.state === "recording") recorderRef.current.stop();
        } else void start();
      }}>
      {state === "recording" ? "■ " + Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0")
        : state === "converting" ? "Preparando áudio..." : "🎤 Áudio"}
    </button>
  );
}
