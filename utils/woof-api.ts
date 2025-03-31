interface Message {
  id: string;
  content: string;
  sender: "user" | "ai";
  timestamp: Date;
}

// Convert app message format to OpenAI format
const formatMessagesForAPI = (messages: Message[]) => {
  return messages
    .filter((msg) => msg.sender === "user" || msg.sender === "ai")
    .map((msg) => ({
      role: msg.sender === "user" ? "user" : "assistant",
      content: msg.content,
    }));
};

// Function to send text message to the API
export async function sendMessageToWoofAI(
  message: string,
  conversationHistory: Message[]
) {
  try {
    const formattedHistory = formatMessagesForAPI(conversationHistory);

    const response = await fetch("/api/woof", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message,
        messageType: "text",
        conversationHistory: formattedHistory,
        userId: localStorage.getItem("woofUserId") || "anonymous-user",
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || "Failed to get response from Woof.ai");
    }

    const data = await response.json();
    return data.response;
  } catch (error) {
    console.error("Error sending message to Woof.ai:", error);
    return "Woof! I'm having trouble responding right now. Please try again later.";
  }
}

// Function to send audio to the API for transcription
export async function transcribeAudioForWoofAI(audioBlob: Blob) {
  try {
    const formData = new FormData();
    formData.append("audio", audioBlob);

    const response = await fetch("/api/woof", {
      method: "PUT",
      body: formData,
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || "Failed to transcribe audio");
    }

    const data = await response.json();
    return data.transcription;
  } catch (error) {
    console.error("Error transcribing audio:", error);
    return null;
  }
}

// Combined function for audio messages - transcribe then send
export async function processAudioMessageForWoofAI(
  audioBlob: Blob,
  conversationHistory: Message[]
) {
  const transcription = await transcribeAudioForWoofAI(audioBlob);

  if (!transcription) {
    return "I couldn't understand the audio. Could you try again?";
  }

  // Send the transcribed text to the API
  return sendMessageToWoofAI(transcription, conversationHistory);
}
