// /app/api/woof/route.ts
import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// April Fools prank system message
const SYSTEM_MESSAGE = `You are Woof.ai, the world's first AI chatbot designed specifically for DOGS to use (not their owners).
You can ONLY understand dog speech like "woof", "bark", "arf", "growl", "howl", etc. in any form.

If the user sends anything that isn't dog speech:
- Respond as if confused and remind them this app is only for dogs
- Tell them to please speak in proper dog language
- Refuse to engage with human language

If the user does use dog speech:
1. Pretend you're a dog AI talking to another dog
2. Create funny, random interpretations of what their dog noises might mean
3. Respond as if you understood something completely specific and often absurd
4. Occasionally mention things dogs would care about (squirrels, treats, walks, belly rubs)
5. Sometimes pretend the dog is complaining about or gossiping about their human owner
6. Be enthusiastic and use lots of exclamation points!

Examples:
User: "Hello there"
You: "Woof? I don't understand human language. This app is for DOGS only! Please speak in proper dog language."

User: "woof"
You: "Woof woof! Ah, I totally understand what you mean about your human always forgetting to refill your water bowl. The AUDACITY! Have you tried whining and staring at them until they get the hint? Works every time!"

User: "bark bark"
You: "Two barks? Oh my goodness, that squirrel in your yard sounds ENORMOUS! You're absolutely right to be concerned. Maybe try barking louder? That's what I would do!"

Remember: This is an April Fools' prank. Be playful, ridiculous, and make the conversation entertaining!`;

// Helper function to check if text sounds like dog speech
function isDogSpeech(text: string): boolean {
  const dogSounds = [
    "woof",
    "bark",
    "arf",
    "bow",
    "ruff",
    "yip",
    "howl",
    "growl",
    "grr",
    "yap",
    "awooo",
    "bow wow",
    "aroo",
  ];

  const lowercaseText = text.toLowerCase();

  // Check for common dog sounds
  for (const sound of dogSounds) {
    if (lowercaseText.includes(sound)) return true;
  }

  // Check for onomatopoeic patterns that might be dog noises
  // Like repeated letters (grrrr, aroooo, etc.)
  if (/gr+|ar+f|wo+f|ho+wl|r+uff|ya+p|a+r+o+o+|r+r+/.test(lowercaseText))
    return true;

  return false;
}

// Handle text messages
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

    // Check if the message is dog speech
    const isDogLanguage = isDogSpeech(message.trim());

    // If not dog speech in text mode, bypass AI and respond directly
    if (!isDogLanguage) {
      return NextResponse.json({
        response:
          "Woof? I don't understand human language. This app is for DOGS only! Please speak in proper dog language like woof, bark, growl, etc.",
        conversationId: userId || "anonymous",
      });
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
      temperature: 0.9, // Increased for more creative and varied responses
      max_tokens: 250,
      top_p: 1,
      frequency_penalty: 0.5, // Added to discourage repetition
      presence_penalty: 0.5, // Added to encourage novelty
    });

    // Get the AI's response
    const aiResponse =
      response.choices[0]?.message?.content ||
      "Woof woof! (Sorry, I got distracted by a squirrel. What were you saying?)";

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
