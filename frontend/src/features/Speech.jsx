import { useEffect, useRef, useState } from "react";
import {
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Alert,
  TextField,
} from "@mui/material";
import { Mic, Square, Volume2, LoaderCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { api, post, demoMode } from "../services/api";
import { IconAction } from "../components/Common";

function responseValue(result, task) {
  const output = result.pipelineResponse?.find(
    (item) => item.taskType === task,
  );
  return task === "asr"
    ? output?.output?.[0]?.source
    : output?.audio?.[0]?.audioContent;
}
async function base64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/** Encode mono PCM WAV, which the configured ASR pipeline can accept. */
export function pcmWav(samples, rate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const string = (offset, text) =>
    [...text].forEach((char, index) =>
      view.setUint8(offset + index, char.charCodeAt(0)),
    );
  string(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  string(8, "WAVE");
  string(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  string(36, "data");
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, index) => {
    const value = Math.max(-1, Math.min(1, sample));
    view.setInt16(
      44 + index * 2,
      value < 0 ? value * 32768 : value * 32767,
      true,
    );
  });
  return new Blob([buffer], { type: "audio/wav" });
}
async function wavFromRecording(blob) {
  const audioContext = new AudioContext();
  try {
    const decoded = await audioContext.decodeAudioData(
      await blob.arrayBuffer(),
    );
    const offline = new OfflineAudioContext(
      1,
      Math.ceil(decoded.duration * 16000),
      16000,
    );
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    const rendered = await offline.startRendering();
    return pcmWav(rendered.getChannelData(0), 16000);
  } finally {
    await audioContext.close();
  }
}

export function VoiceInput({ onTranscript, disabled }) {
  const { t, i18n } = useTranslation();
  const hi = i18n.language === "hi";
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState("idle");
  const [error, setError] = useState("");
  const [transcript, setTranscript] = useState("");
  const recorder = useRef(null);
  const stream = useRef(null);
  const timer = useRef(null);
  const operation = useRef(0);
  function cleanup() {
    clearTimeout(timer.current);
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
  }
  useEffect(
    () => () => {
      operation.current += 1;
      if (recorder.current?.state === "recording") recorder.current.stop();
      cleanup();
    },
    [],
  );
  function close() {
    operation.current += 1;
    if (recorder.current?.state === "recording") recorder.current.stop();
    cleanup();
    setOpen(false);
    setPhase("idle");
    setTranscript("");
    setError("");
  }
  async function start() {
    setError("");
    setPhase("checking");
    const request = ++operation.current;
    const cancelled = () => request !== operation.current;
    try {
      if (demoMode) throw new Error(t("voiceUnavailable"));
      const status = await api("/speech/status");
      if (cancelled()) return;
      if (!status.available || !status.asr)
        throw new Error(t("voiceUnavailable"));
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder)
        throw new Error(
          hi
            ? "यह ब्राउज़र रिकॉर्डिंग का समर्थन नहीं करता।"
            : "This browser does not support microphone recording.",
        );
      const recordingStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      if (cancelled()) {
        recordingStream.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.current = recordingStream;
      const parts = [];
      const mediaRecorder = new MediaRecorder(recordingStream);
      recorder.current = mediaRecorder;
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size) parts.push(e.data);
      };
      mediaRecorder.onerror = () => {
        if (cancelled()) return;
        cleanup();
        setError(
          hi
            ? "रिकॉर्डिंग विफल। कृपया लिखकर जारी रखें।"
            : "Recording failed. Please continue with text.",
        );
        setPhase("idle");
      };
      mediaRecorder.onstop = async () => {
        if (cancelled()) return;
        cleanup();
        setPhase("processing");
        try {
          const wav = await wavFromRecording(
            new Blob(parts, { type: mediaRecorder.mimeType }),
          );
          if (cancelled()) return;
          const result = await post("/speech", {
            task: "asr",
            language: i18n.language,
            audio_format: "wav",
            audio: await base64(wav),
          });
          if (cancelled()) return;
          const text = responseValue(result, "asr");
          if (!text)
            throw new Error(
              hi ? "वाणी पहचानी नहीं गई।" : "No transcript was returned.",
            );
          setTranscript(text);
          setPhase("review");
        } catch (e) {
          if (!cancelled()) {
            setError(e.message);
            setPhase("idle");
          }
        }
      };
      mediaRecorder.start();
      setPhase("recording");
      timer.current = setTimeout(() => {
        if (mediaRecorder.state === "recording") mediaRecorder.stop();
      }, 60000);
    } catch (e) {
      if (cancelled()) return;
      cleanup();
      setError(e.message);
      setPhase("idle");
    }
  }
  return (
    <>
      <IconAction
        label={t("voice")}
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <Mic size={17} />
      </IconAction>
      <Dialog open={open} onClose={close} fullWidth maxWidth="sm">
        <DialogTitle>
          {hi
            ? "आवाज़ से प्रश्न तैयार करें"
            : "Prepare a question with your voice"}
        </DialogTitle>
        <DialogContent>
          <p className="small muted">
            {hi
              ? "अधिकतम 60 सेकंड। ऑडियो Bhashini को भेजा जाता है। भेजने से पहले लिखित प्रश्न की समीक्षा करें।"
              : "Up to 60 seconds. Audio is sent to Bhashini for transcription. Review the text before submitting your question."}
          </p>
          {error && <Alert severity="info">{error}</Alert>}
          {phase === "processing" || phase === "checking" ? (
            <p role="status">{t("loading")}</p>
          ) : phase === "recording" ? (
            <Button
              color="error"
              startIcon={<Square size={16} />}
              onClick={() => recorder.current?.stop()}
            >
              {hi ? "रिकॉर्डिंग रोकें" : "Stop recording"}
            </Button>
          ) : phase === "review" ? (
            <TextField
              label={hi ? "लिखित प्रश्न की समीक्षा करें" : "Review transcript"}
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
              multiline
              minRows={4}
              fullWidth
              inputProps={{ maxLength: 8000 }}
            />
          ) : (
            <Button startIcon={<Mic size={16} />} onClick={start}>
              {hi ? "रिकॉर्डिंग शुरू करें" : "Start recording"}
            </Button>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={close}>{t("cancel")}</Button>
          {phase === "review" && (
            <Button
              disabled={!transcript.trim()}
              variant="contained"
              onClick={() => {
                onTranscript(transcript.trim());
                close();
              }}
            >
              {hi ? "प्रश्न में जोड़ें" : "Use in question"}
            </Button>
          )}
        </DialogActions>
      </Dialog>
    </>
  );
}

export function ReadAloud({ text, language }) {
  const { i18n } = useTranslation();
  const hi = i18n.language === "hi";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const playback = useRef(null);
  const url = useRef(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      playback.current?.pause();
      if (url.current) URL.revokeObjectURL(url.current);
    };
  }, []);
  async function speak() {
    setBusy(true);
    setError("");
    try {
      if (demoMode)
        throw new Error(
          hi
            ? "डेमो में वाणी सेवा जुड़ी नहीं है।"
            : "Speech playback is not connected in demo mode.",
        );
      const result = await post("/speech", {
        task: "tts",
        language,
        text: text.slice(0, 12000),
      });
      if (!mounted.current) return;
      const data = responseValue(result, "tts");
      if (!data) throw new Error("No speech audio was returned.");
      playback.current?.pause();
      if (url.current) URL.revokeObjectURL(url.current);
      url.current = URL.createObjectURL(
        new Blob([Uint8Array.from(atob(data), (c) => c.charCodeAt(0))], {
          type: "audio/wav",
        }),
      );
      playback.current = new Audio(url.current);
      await playback.current.play();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <IconAction
        label={hi ? "उत्तर सुनें" : "Read answer aloud"}
        onClick={speak}
        disabled={busy}
      >
        {busy ? <LoaderCircle size={16} /> : <Volume2 size={16} />}
      </IconAction>
      {error && (
        <span className="small muted" role="status">
          {error}
        </span>
      )}
    </>
  );
}
