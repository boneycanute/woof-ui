// /app/page.tsx
"use client";
import React, { useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Mic, MessageSquare } from "lucide-react";

// Import components
import { ChatMessageList } from "@/components/woof-ui/chat-message-list";
import {
  ChatBubble,
  ChatBubbleMessage,
  ChatBubbleAvatar,
} from "@/components/woof-ui/chat-bubble";
import {
  ChatInput,
  ChatInputTextArea,
  ChatInputSubmit,
} from "@/components/woof-ui/chat-input";
import { AIVoiceInput } from "@/components/woof-ui/ai-voice-input";
import { Badge } from "@/components/woof-ui/badge";

// Define message type
interface Message {
  id: string;
  content: string;
  sender: "user" | "ai";
  timestamp: Date;
}

// API functions for Woof.ai
const formatMessagesForAPI = (messages: Message[]) => {
  return messages
    .filter((msg) => msg.sender === "user" || msg.sender === "ai")
    .map((msg) => ({
      role: msg.sender === "user" ? "user" : "assistant",
      content: msg.content,
    }));
};

async function sendMessageToWoofAI(
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

// Define the tabs for input selection
const inputTabs = [
  { id: "text", label: "Text", icon: <MessageSquare className="h-4 w-4" /> },
  { id: "voice", label: "Voice", icon: <Mic className="h-4 w-4" /> },
];

export default function ChatInterface() {
  // State
  const [activeTab, setActiveTab] = useState<string>("text");
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [messagesRemaining, setMessagesRemaining] = useState(10);
  const [isVoiceProcessing, setIsVoiceProcessing] = useState(false);
  const messageIdCounter = useRef(0);

  // Audio recording refs
  const audioRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  // Generate unique message ID
  const generateMessageId = () => {
    messageIdCounter.current += 1;
    return `msg-${messageIdCounter.current}`;
  };

  // Handle input change
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputValue(e.target.value);
  };

  // Handle message submission
  const handleSubmit = async () => {
    if (inputValue.trim() === "" || messagesRemaining <= 0 || isLoading) return;

    // Add user message
    const newUserMessage: Message = {
      id: generateMessageId(),
      content: inputValue,
      sender: "user",
      timestamp: new Date(),
    };

    // Update messages state with user message
    setMessages((prev) => [...prev, newUserMessage]);
    const userInput = inputValue; // Store the input value
    setInputValue("");
    setIsLoading(true);
    setMessagesRemaining((prev) => prev - 1);

    try {
      // Send request to the API with conversation history
      const aiResponseText = await sendMessageToWoofAI(
        userInput,
        messages // Pass current conversation history
      );

      // Create AI response message
      const aiResponse: Message = {
        id: generateMessageId(),
        content: aiResponseText,
        sender: "ai",
        timestamp: new Date(),
      };

      // Update messages state with AI response
      setMessages((prev) => [...prev, aiResponse]);
    } catch (error) {
      console.error("Error getting response:", error);

      // Handle error with a fallback message
      const errorMessage: Message = {
        id: generateMessageId(),
        content:
          "Woof! I'm having trouble responding right now. Please try again later.",
        sender: "ai",
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  // Handle voice input
  const handleVoiceStart = () => {
    console.log("Voice recording started");
    // Set flag to prevent multiple submissions
    setIsVoiceProcessing(true);
    audioChunksRef.current = [];

    // Start recording
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        // Use audio/webm MIME type for better compatibility with Whisper
        const options = { mimeType: "audio/webm" };

        // Check if this MIME type is supported
        if (MediaRecorder.isTypeSupported("audio/webm")) {
          audioRecorderRef.current = new MediaRecorder(stream, options);
        } else {
          // Fallback to default
          audioRecorderRef.current = new MediaRecorder(stream);
        }

        audioRecorderRef.current.addEventListener("dataavailable", (event) => {
          if (event.data.size > 0) {
            audioChunksRef.current.push(event.data);
          }
        });

        audioRecorderRef.current.start();
      })
      .catch((err) => {
        console.error("Error accessing microphone:", err);
        setIsVoiceProcessing(false);
      });
  };

  const handleVoiceStop = async (duration: number) => {
    // Prevent duplicate submissions
    if (
      !isVoiceProcessing ||
      isLoading ||
      messagesRemaining <= 0 ||
      !audioRecorderRef.current
    ) {
      return;
    }

    try {
      setIsLoading(true);

      // Create a promise to wait for the recording to stop
      const recordingStopped = new Promise<Blob>((resolve) => {
        if (audioRecorderRef.current) {
          audioRecorderRef.current.addEventListener("stop", () => {
            // Use webm format for better compatibility
            const audioBlob = new Blob(audioChunksRef.current, {
              type: "audio/webm",
            });
            resolve(audioBlob);
          });

          audioRecorderRef.current.stop();
        }
      });

      // Wait for the recording to stop and get the audio blob
      const audioBlob = await recordingStopped;

      // Add user message for voice
      const newUserMessage: Message = {
        id: generateMessageId(),
        content: `[Voice message: ${duration} seconds]`,
        sender: "user",
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, newUserMessage]);
      setMessagesRemaining((prev) => prev - 1);

      // First, transcribe the audio
      const formData = new FormData();
      formData.append("audio", audioBlob);

      const transcriptionResponse = await fetch("/api/woof", {
        method: "PUT",
        body: formData,
      });

      if (!transcriptionResponse.ok) {
        throw new Error("Failed to transcribe audio");
      }

      const transcriptionData = await transcriptionResponse.json();
      const transcribedText = transcriptionData.transcription;

      if (!transcribedText) {
        throw new Error("No text was transcribed from the audio");
      }

      // Now send the transcribed text to get an AI response
      const responseData = await sendMessageToWoofAI(transcribedText, messages);

      // Add AI response message
      const aiResponse: Message = {
        id: generateMessageId(),
        content: responseData,
        sender: "ai",
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, aiResponse]);
    } catch (error) {
      console.error("Error processing voice message:", error);

      // Add AI error response
      const errorMessage: Message = {
        id: generateMessageId(),
        content:
          "Woof! I had trouble understanding your voice message. Could you try again or type your message?",
        sender: "ai",
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
      setIsVoiceProcessing(false);

      // Clean up
      if (audioRecorderRef.current && audioRecorderRef.current.stream) {
        audioRecorderRef.current.stream
          .getTracks()
          .forEach((track) => track.stop());
      }
    }
  };

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-background">
      {/* Main layout with fixed sections */}
      <motion.div className="flex flex-col h-full">
        {messages.length != 0 ? (
          <motion.div
            className="w-full max-w-2xl mx-auto px-4 flex items-center justify-between"
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <span className="flex items-center gap-2 text-xl font-bold text-muted-foreground">
              <img
                src="/pug.webp"
                alt="Pug Logo"
                className="w-16 h-16 object-cover rounded-full"
              />
              Woof.ai
            </span>
            <Badge
              variant="outline"
              className="bg-background/80 backdrop-blur-sm"
            >
              {messagesRemaining} messages remaining
            </Badge>
          </motion.div>
        ) : (
          <></>
        )}
        {/* Chat messages container - takes all available space */}
        <div className="flex-1 overflow-hidden flex justify-center pt-2">
          <div className="w-full max-w-2xl relative">
            {messages.length === 0 ? (
              <motion.div
                className="absolute inset-0 flex flex-col items-center justify-center"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.5 }}
              >
                <div className="p-8">
                  <img
                    src="/pug.webp"
                    alt="Pug Logo"
                    className="w-48 h-48 object-cover rounded-full"
                  />
                </div>
                <p className="text-muted-foreground text-center space-y-4 ">
                  World's First AI Chatbot for Dogs <br />{" "}
                  <span className="block mt-1">Fluent in Woof!🐾</span>
                </p>
              </motion.div>
            ) : (
              <div className="h-full">
                <ChatMessageList smooth>
                  {messages.map((message) => (
                    <ChatBubble
                      key={message.id}
                      variant={message.sender === "user" ? "sent" : "received"}
                    >
                      {message.sender === "ai" && (
                        <ChatBubbleAvatar fallback="🤖" />
                      )}
                      {message.sender === "user" && (
                        <ChatBubbleAvatar fallback="🐶" />
                      )}
                      <div className="max-w-[75%]">
                        <ChatBubbleMessage
                          variant={
                            message.sender === "user" ? "sent" : "received"
                          }
                          className="break-words whitespace-pre-wrap"
                        >
                          {message.content}
                        </ChatBubbleMessage>
                      </div>
                    </ChatBubble>
                  ))}

                  {isLoading && (
                    <ChatBubble variant="received">
                      <ChatBubbleAvatar fallback="AI" />
                      <div className="max-w-[75%]">
                        <ChatBubbleMessage
                          variant="received"
                          isLoading={true}
                        />
                      </div>
                    </ChatBubble>
                  )}
                </ChatMessageList>
              </div>
            )}
          </div>
        </div>

        {/* Fixed bottom section with input controls - does not scroll */}
        <div className="bg-background">
          <div className="max-w-2xl mx-auto w-full px-4 pt-4">
            {/* Tabs for input selection */}
            <motion.div className="flex justify-center mb-4" layout>
              <div className="flex space-x-2 p-1 bg-[#fce5c1] rounded-full">
                {inputTabs.map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => {
                      if (!isLoading) {
                        setActiveTab(tab.id);
                        // Reset voice processing flag when switching tabs
                        if (tab.id === "voice") {
                          setIsVoiceProcessing(false);
                        }
                      }
                    }}
                    disabled={isLoading}
                    className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                      activeTab === tab.id
                        ? "bg-[#f5a96b] text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    } ${isLoading ? "opacity-50 cursor-not-allowed" : ""}`}
                  >
                    {tab.icon}
                    {tab.label}
                  </button>
                ))}
              </div>
            </motion.div>

            {/* Input area */}
            <AnimatePresence mode="wait">
              {activeTab === "text" ? (
                <motion.div
                  key="text-input"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 10 }}
                  transition={{ duration: 0.2 }}
                  layout
                >
                  <ChatInput
                    value={inputValue}
                    onChange={handleInputChange}
                    onSubmit={handleSubmit}
                    loading={isLoading}
                    className="rounded-xl mb-4 "
                  >
                    <ChatInputTextArea
                      placeholder="Type a message..."
                      disabled={isLoading || messagesRemaining <= 0}
                    />
                    <ChatInputSubmit
                      disabled={isLoading || messagesRemaining <= 0}
                    />
                  </ChatInput>
                </motion.div>
              ) : (
                <motion.div
                  key="voice-input"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 10 }}
                  transition={{ duration: 0.2 }}
                  layout
                >
                  {messagesRemaining > 0 && !isLoading ? (
                    <div className="border border-input rounded-xl bg-background mb-4">
                      <AIVoiceInput
                        onStart={handleVoiceStart}
                        onStop={handleVoiceStop}
                        visualizerBars={32}
                        demoMode={false}
                      />
                    </div>
                  ) : (
                    <div className="p-4 border border-input rounded-xl text-center text-muted-foreground mb-4">
                      {isLoading
                        ? "Processing your voice message..."
                        : "No messages remaining"}
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Footer */}
        <div className="p-2 text-center text-xs text-muted-foreground">
          Built using{" "}
          <a href="/" className=" font-bold hover:text-foreground">
            Build That Idea
          </a>
        </div>
      </motion.div>
    </div>
  );
}
