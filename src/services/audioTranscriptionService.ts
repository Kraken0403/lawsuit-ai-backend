import OpenAI, { toFile } from "openai";
import { env } from "../config/env.js";

const openai = new OpenAI({
  apiKey: env.llm.apiKey,
  baseURL: env.llm.baseUrl,
});

export async function transcribeAudioBuffer(params: {
  buffer: Buffer;
  fileName: string;
  mimeType: string;
  language?: string | null;
  prompt?: string | null;
}) {
  const model = env.llm.transcriptionModel;

  const file = await toFile(params.buffer, params.fileName, {
    type: params.mimeType,
  });

  const transcription = await openai.audio.transcriptions.create({
    file,
    model,
    ...(params.language ? { language: params.language } : {}),
    ...(params.prompt ? { prompt: params.prompt } : {}),
  });

  return {
    text: String(transcription.text || "").trim(),
    model,
    usage: transcription.usage ?? null,
  };
}