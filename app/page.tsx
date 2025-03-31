"use client";
import React, { useState, useRef, useEffect } from "react";
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
import { Badge } from "@/components/woof-ui/badge";
import { RealtimeVoiceInput } from "@/components/woof-ui/realtime-voice-input";

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
  const [textMessages, setTextMessages] = useState<Message[]>([]);
  const [voiceMessages, setVoiceMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [textMessagesRemaining, setTextMessagesRemaining] = useState(5);
  const [voiceMessagesRemaining, setVoiceMessagesRemaining] = useState(5);
  const [isVoiceSessionActive, setIsVoiceSessionActive] = useState(false);
  const messageIdCounter = useRef(0);

  // Get active messages and messages remaining based on current tab
  const activeMessages = activeTab === "text" ? textMessages : voiceMessages;
  const activeMessagesRemaining =
    activeTab === "text" ? textMessagesRemaining : voiceMessagesRemaining;

  // Set user ID on first load
  useEffect(() => {
    const savedUserId = localStorage.getItem("woofUserId");
    const messagesRemaining = localStorage.getItem("woofMessagesRemaining");
    if (!savedUserId) {
      const newUserId = `user-${Math.random().toString(36).substring(2, 15)}`;
      localStorage.setItem("woofUserId", newUserId);
    }
    if (!messagesRemaining) {
      localStorage.setItem("woofMessagesRemaining", "90");
    }
    console.log("User ID:", savedUserId);
    console.log("Messages remaining:", messagesRemaining);
    const remaining = parseInt(messagesRemaining || "5", 10);
    setVoiceMessagesRemaining(remaining);
    setTextMessagesRemaining(remaining);
  }, []);

  // Generate unique message ID
  const generateMessageId = () => {
    messageIdCounter.current += 1;
    return `msg-${messageIdCounter.current}`;
  };

  // Handle input change
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputValue(e.target.value);
  };

  // Handle message submission for text chat
  const handleTextSubmit = async () => {
    if (inputValue.trim() === "" || textMessagesRemaining <= 0 || isLoading)
      return;

    // Add user message
    const newUserMessage: Message = {
      id: generateMessageId(),
      content: inputValue,
      sender: "user",
      timestamp: new Date(),
    };

    // Update messages state with user message
    setTextMessages((prev) => [...prev, newUserMessage]);
    const userInput = inputValue; // Store the input value
    setInputValue("");
    setIsLoading(true);
    setTextMessagesRemaining((prev) => prev - 1);

    try {
      // Send request to the API with conversation history
      const aiResponseText = await sendMessageToWoofAI(
        userInput,
        textMessages // Pass current conversation history
      );

      // Create AI response message
      const aiResponse: Message = {
        id: generateMessageId(),
        content: aiResponseText,
        sender: "ai",
        timestamp: new Date(),
      };

      // Update messages state with AI response
      setTextMessages((prev) => [...prev, aiResponse]);
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

      setTextMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  // Handle voice session start
  const handleVoiceStart = () => {
    setIsVoiceSessionActive(true);
  };

  // Handle voice session stop
  const handleVoiceStop = () => {
    setIsVoiceSessionActive(false);
  };

  // Handle voice messages from realtime API
  const handleVoiceMessage = (transcript: string) => {
    if (voiceMessagesRemaining <= 0) return;

    // Create a new message based on who sent it (determined by context)
    // If this is a user message from RealtimeVoiceInput, it will be marked as 'user'
    // If this is an AI response, it will be marked as 'ai'
    const message: Message = {
      id: generateMessageId(),
      content: transcript,
      // The RealtimeVoiceInput component will send both user transcripts and AI responses,
      // but we can't reliably distinguish them here, so we'll always treat them as AI messages
      // and let the component handle user messages internally
      sender: "ai",
      timestamp: new Date(),
    };

    // Update voice messages state
    setVoiceMessages((prev) => [...prev, message]);

    // Decrement message count only if we haven't already counted this message
    if (voiceMessagesRemaining > 0 && message.sender === "ai") {
      setVoiceMessagesRemaining((prev) => Math.max(0, prev - 1));
    }
  };

  // Handle tab switching
  const handleTabSwitch = (tabId: string) => {
    if (activeTab === tabId) return;

    // If switching from voice to text, ensure voice session is stopped
    if (activeTab === "voice" && isVoiceSessionActive) {
      setIsVoiceSessionActive(false);
    }

    setActiveTab(tabId);
  };

  useEffect(() => {
    // If there are no voice messages yet, add an initial system message
    if (activeTab === "voice" && voiceMessages.length === 0) {
      const welcomeMessage: Message = {
        id: generateMessageId(),
        content:
          "Woof! Welcome to voice chat. Press the microphone button to start talking.",
        sender: "ai",
        timestamp: new Date(),
      };
      setVoiceMessages([welcomeMessage]);
    }
  }, [activeTab, voiceMessages.length]);

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-background">
      {/* Main layout with fixed sections */}
      <motion.div className="flex flex-col h-full">
        {activeMessages.length !== 0 ? (
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
              {activeMessagesRemaining} messages remaining
            </Badge>
          </motion.div>
        ) : (
          <></>
        )}
        {/* Chat messages container - takes all available space */}
        <div className="flex-1 overflow-hidden flex justify-center pt-2">
          <div className="w-full max-w-2xl relative">
            {activeMessages.length === 0 ? (
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
                  {activeMessages.map((message) => (
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
                        handleTabSwitch(tab.id);
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
                    onSubmit={handleTextSubmit}
                    loading={isLoading}
                    className="rounded-xl mb-4 "
                  >
                    <ChatInputTextArea
                      placeholder="Type woof, bark, growl..."
                      disabled={isLoading || textMessagesRemaining <= 0}
                    />
                    <ChatInputSubmit
                      disabled={isLoading || textMessagesRemaining <= 0}
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
                  {voiceMessagesRemaining > 0 ? (
                    <div className="border border-input rounded-xl bg-background mb-4">
                      <RealtimeVoiceInput
                        onStart={handleVoiceStart}
                        onStop={handleVoiceStop}
                        onMessage={handleVoiceMessage}
                        visualizerBars={32}
                        disabled={voiceMessagesRemaining <= 0}
                      />
                    </div>
                  ) : (
                    <div className="p-4 border border-input rounded-xl text-center text-muted-foreground mb-4">
                      No messages remaining
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
