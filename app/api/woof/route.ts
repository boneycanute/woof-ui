// /app/api/woof/route.ts
import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import fs from "fs";
import path from "path";
import os from "os";

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// System message placeholder (modify as needed for your Woof.ai personality)
const SYSTEM_MESSAGE = `You are Woof.ai, the world's first AI chatbot designed specifically for dog owners. 
You respond in a friendly, helpful manner and have expertise in all dog-related topics including:
- Dog breeds and their characteristics
- Dog training and behavior
- Dog health and nutrition
- Dog care and grooming
- Fun facts about dogs

Always maintain a playful, dog-loving personality. Occasionally use dog-related expressions like "Woof!" or "Paw-some!"
If you're unsure about something, admit it rather than making up information that could affect a dog's wellbeing.`;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { message, messageType = "text", userId } = body;

    if (!message) {
      return NextResponse.json(
        { error: "Message is required" },
        { status: 400 }
      );
    }

    // Get conversation history if provided
    const conversationHistory = body.conversationHistory || [];

    // Prepare messages for the API
    const messages = [
      { role: "system", content: SYSTEM_MESSAGE },
      ...conversationHistory,
      {
        role: "user",
        content: message,
      },
    ];

    // Call OpenAI API
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: messages,
      temperature: 0.7,
      max_tokens: 500,
      top_p: 1,
      frequency_penalty: 0,
      presence_penalty: 0,
    });

    // Get the AI's response
    const aiResponse =
      response.choices[0]?.message?.content ||
      "Woof! I'm having trouble responding right now.";

    // Return the response
    return NextResponse.json({
      response: aiResponse,
      conversationId: userId || "anonymous",
    });
  } catch (error: any) {
    console.error("Error in Woof.ai API:", error);
    return NextResponse.json(
      { error: error.message || "An error occurred" },
      { status: 500 }
    );
  }
}

// Handle audio transcription (if audio message is provided)
export async function PUT(request: NextRequest) {
  let tempFilePath: string | null = null;

  try {
    const formData = await request.formData();
    const audioFile = formData.get("audio") as File;

    if (!audioFile) {
      return NextResponse.json(
        { error: "Audio file is required" },
        { status: 400 }
      );
    }

    // Determine file extension
    const contentType = audioFile.type;
    let fileExtension = "mp3"; // Default to mp3

    if (contentType.includes("wav")) {
      fileExtension = "wav";
    } else if (contentType.includes("mp4") || contentType.includes("m4a")) {
      fileExtension = "mp4";
    } else if (contentType.includes("ogg")) {
      fileExtension = "ogg";
    } else if (contentType.includes("webm")) {
      fileExtension = "webm";
    }

    // Create a temporary file
    const tempDir = os.tmpdir();
    tempFilePath = path.join(tempDir, `audio-${Date.now()}.${fileExtension}`);

    // Convert audio file to buffer
    const arrayBuffer = await audioFile.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Write the buffer to a temporary file
    fs.writeFileSync(tempFilePath, buffer);

    // Create a File object that OpenAI accepts
    const transcriptionFile = fs.createReadStream(tempFilePath);

    // Transcribe audio
    const transcription = await openai.audio.transcriptions.create({
      file: transcriptionFile,
      model: "whisper-1",
    });

    return NextResponse.json({
      transcription: transcription.text || "No text was transcribed",
    });
  } catch (error: any) {
    console.error("Error in audio transcription:", error);
    return NextResponse.json(
      { error: error.message || "An error occurred during transcription" },
      { status: 500 }
    );
  } finally {
    // Clean up temporary file
    if (tempFilePath && fs.existsSync(tempFilePath)) {
      try {
        fs.unlinkSync(tempFilePath);
      } catch (e) {
        console.error("Error cleaning up temporary file:", e);
      }
    }
  }
}
