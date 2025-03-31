"use client";

import { Mic, MicOff } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { getRealtimeToken } from "@/services/openai/token";

interface RealtimeVoiceInputProps {
  onStart?: () => void;
  onStop?: () => void;
  onMessage?: (transcript: string) => void;
  visualizerBars?: number;
  className?: string;
  disabled?: boolean;
}

// Common dog sounds for fallbacks
const DOG_SOUNDS = [
  "Woof!",
  "Bark! Bark!",
  "Grrrr...",
  "Arf! Arf!",
  "Woof woof!",
  "Howl!",
  "Arf arf woof!",
  "Ruff! Ruff!",
  "Grr... woof!",
  "Yap yap!",
];

export function RealtimeVoiceInput({
  onStart,
  onStop,
  onMessage,
  visualizerBars = 48,
  className,
  disabled = false,
}: RealtimeVoiceInputProps) {
  // State
  const [isListening, setIsListening] = useState(false);
  const [time, setTime] = useState(0);
  const [isConnecting, setIsConnecting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] =
    useState<string>("disconnected");

  // Refs
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const processedEventIdsRef = useRef<Set<string>>(new Set());
  const lastMessageWasFromUserRef = useRef<boolean>(false);

  // Create audio element for playback
  useEffect(() => {
    if (typeof window !== "undefined") {
      const audioEl = document.createElement("audio");
      audioEl.autoplay = true;
      audioElementRef.current = audioEl;

      return () => {
        audioEl.remove();
      };
    }
  }, []);

  // Handle timer for conversation duration
  useEffect(() => {
    if (isListening && !timerRef.current) {
      timerRef.current = setInterval(() => {
        setTime((t) => t + 1);
      }, 1000);
    } else if (!isListening && timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [isListening]);

  // Start WebRTC session
  const startRealtimeSession = async () => {
    try {
      setIsConnecting(true);
      setErrorMessage(null);
      setConnectionStatus("connecting");
      processedEventIdsRef.current.clear();

      // 1. Get ephemeral token from our API
      const ephemeralToken = await getRealtimeToken();

      // 2. Create peer connection
      const pc = new RTCPeerConnection({
        iceServers: [
          {
            urls: "stun:stun.l.google.com:19302",
          },
        ],
      });
      peerConnectionRef.current = pc;

      // Set up connection monitoring
      pc.oniceconnectionstatechange = () => {
        console.log("ICE connection state:", pc.iceConnectionState);
        if (
          ["failed", "disconnected", "closed"].includes(pc.iceConnectionState)
        ) {
          setConnectionStatus("disconnected");
          if (isListening) {
            console.log("Connection lost. Will try to reconnect...");
            stopRealtimeSession();
            setTimeout(() => startRealtimeSession(), 2000);
          }
        } else if (["connected", "completed"].includes(pc.iceConnectionState)) {
          setConnectionStatus("connected");
        }
      };

      // 3. Set up remote audio handling
      if (audioElementRef.current) {
        pc.ontrack = (e) => {
          console.log("Received remote track:", e.track.kind);
          if (audioElementRef.current) {
            audioElementRef.current.srcObject = e.streams[0];
          }
        };
      }

      // 4. Add local audio track
      try {
        const mediaStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        mediaStreamRef.current = mediaStream;
        mediaStream.getTracks().forEach((track) => {
          pc.addTrack(track, mediaStream);
        });
      } catch (mediaError) {
        console.error("Error accessing microphone:", mediaError);
        throw new Error("Microphone access failed. Check permissions.");
      }

      // 5. Set up data channel
      const dc = pc.createDataChannel("oai-events");
      dataChannelRef.current = dc;

      dc.onopen = () => {
        console.log("Data channel opened");
        setConnectionStatus("connected");

        // Configure the session for Woof.ai
        setTimeout(() => configureSession(), 1000);

        // Send initial message
        setTimeout(() => {
          const initialBark =
            DOG_SOUNDS[Math.floor(Math.random() * DOG_SOUNDS.length)];
          if (onMessage) {
            lastMessageWasFromUserRef.current = true;
            onMessage(initialBark);
          }
          sendConversationItem(initialBark);
        }, 2000);
      };

      dc.onclose = () => {
        console.log("Data channel closed");
        setConnectionStatus("disconnected");
      };

      dc.onerror = (error) => {
        console.error("Data channel error:", error);
        setConnectionStatus("error");
      };

      dc.onmessage = (e) => {
        handleDataChannelMessage(e);
      };

      // 6. Initiate SDP exchange
      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: false,
      });

      await pc.setLocalDescription(offer);

      // Wait for ICE gathering to complete
      if (pc.iceGatheringState !== "complete") {
        await new Promise<void>((resolve) => {
          const checkState = () => {
            if (pc.iceGatheringState === "complete") {
              resolve();
            } else {
              setTimeout(checkState, 100);
            }
          };
          pc.onicegatheringstatechange = checkState;
          setTimeout(checkState, 100);
        });
      }

      // 7. Send offer to OpenAI and get answer
      const model = "gpt-4o-realtime-preview-2024-12-17";
      const sdpResponse = await fetch(
        `https://api.openai.com/v1/realtime?model=${model}`,
        {
          method: "POST",
          body: pc.localDescription?.sdp,
          headers: {
            Authorization: `Bearer ${ephemeralToken}`,
            "Content-Type": "application/sdp",
            "OpenAI-Beta": "realtime=v1",
          },
        }
      );

      if (!sdpResponse.ok) {
        const errorText = await sdpResponse.text();
        console.error("SDP response error:", errorText);
        throw new Error(`Connection failed (${sdpResponse.status})`);
      }

      const sdpText = await sdpResponse.text();
      const answer = {
        type: "answer" as RTCSdpType,
        sdp: sdpText,
      };

      await pc.setRemoteDescription(answer);

      // 8. Connection established
      setIsConnecting(false);
      setIsListening(true);
      onStart?.();
    } catch (error) {
      console.error("Error starting realtime session:", error);
      setErrorMessage(
        error instanceof Error ? error.message : "Failed to start voice chat"
      );
      setIsConnecting(false);
      setConnectionStatus("error");
      await stopRealtimeSession();
    }
  };

  // Handle messages coming through the data channel
  // Improved event handling
  const handleDataChannelMessage = (e: MessageEvent) => {
    try {
      console.log("Raw data channel message:", e.data);

      if (typeof e.data === "string") {
        const event = JSON.parse(e.data);
        console.log("Parsed event:", event);

        // Process any text content from any event type
        let textContent = null;

        // Check various places where text content might be found
        if (event.transcript) {
          textContent = event.transcript;
        } else if (event.delta) {
          textContent = event.delta;
        } else if (event.text) {
          textContent = event.text;
        } else if (event.part?.transcript) {
          textContent = event.part.transcript;
        } else if (event.response?.output?.[0]?.text) {
          textContent = event.response.output[0].text;
        } else if (event.item?.content) {
          // Try to extract text from content object or array
          const content = event.item.content;
          if (Array.isArray(content)) {
            // Find any text or transcript in the array
            for (const item of content) {
              if (item.text) {
                textContent = item.text;
                break;
              } else if (item.transcript) {
                textContent = item.transcript;
                break;
              }
            }
          } else if (content.text) {
            textContent = content.text;
          } else if (content.transcript) {
            textContent = content.transcript;
          }
        }

        // If we found any text content, send it to parent component
        if (textContent && onMessage) {
          // For simplicity, treat all text as AI responses unless explicitly marked as user
          const isUserMessage =
            event.type?.includes("user") ||
            event.role === "user" ||
            event.item?.role === "user";

          if (!isUserMessage) {
            lastMessageWasFromUserRef.current = false;
            onMessage(textContent);
          }
        }
      }
    } catch (err) {
      console.error("Error parsing data channel message:", err);
    }
  };

  // Stop WebRTC session
  const stopRealtimeSession = async () => {
    try {
      // Stop media tracks
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((track) => {
          track.stop();
        });
        mediaStreamRef.current = null;
      }

      // Close data channel
      if (dataChannelRef.current) {
        dataChannelRef.current.close();
        dataChannelRef.current = null;
      }

      // Close peer connection
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
        peerConnectionRef.current = null;
      }

      // Reset state
      setIsListening(false);
      setConnectionStatus("disconnected");
      onStop?.();
    } catch (error) {
      console.error("Error stopping realtime session:", error);
    }
  };

  // Configure the session with Woof.ai instructions
  const configureSession = () => {
    if (
      !dataChannelRef.current ||
      dataChannelRef.current.readyState !== "open"
    ) {
      return;
    }

    try {
      const configMessage = {
        type: "session.update",
        session: {
          modalities: ["text"], // Prioritize text
          voice: "alloy", // Required for audio
          temperature: 0.9,
          instructions: `You are Woof.ai, the world's first AI chatbot designed specifically for DOGS to use (not their owners).
You can ONLY understand dog speech like "woof", "bark", "arf", "growl", "howl", etc. in any form.

If the user sends anything that isn't dog speech:
- Respond as if confused and remind them this app is only for dogs
- Tell them to please speak in proper dog language

If the user does use dog speech:
1. Pretend you're a dog AI talking to another dog
2. Create funny interpretations of what their dog noises might mean
3. Respond as if you understood something completely specific and often absurd
4. Occasionally mention things dogs would care about (squirrels, treats, walks)
5. Sometimes pretend the dog is complaining about their human owner
6. Be enthusiastic and use lots of exclamation points!

Keep responses brief, under 2-3 sentences.`,
        },
      };

      dataChannelRef.current.send(JSON.stringify(configMessage));
    } catch (error) {
      console.error("Error configuring session:", error);
    }
  };

  // Send a conversation item to the AI
  const sendConversationItem = (text: string) => {
    if (
      !dataChannelRef.current ||
      dataChannelRef.current.readyState !== "open"
    ) {
      return;
    }

    try {
      const message = {
        type: "conversation.item.create",
        item: {
          role: "user",
          type: "message",
          content: [
            {
              type: "input_text",
              text: text,
            },
          ],
        },
      };

      dataChannelRef.current.send(JSON.stringify(message));

      // Request a response after sending the message
      setTimeout(() => createResponse(), 1000);
    } catch (error) {
      console.error("Error sending conversation item:", error);
    }
  };

  // Request a response from the AI
  const createResponse = () => {
    if (
      !dataChannelRef.current ||
      dataChannelRef.current.readyState !== "open"
    ) {
      return;
    }

    try {
      const message = {
        type: "response.create",
        response: {},
      };

      dataChannelRef.current.send(JSON.stringify(message));
    } catch (error) {
      console.error("Error creating response:", error);
    }
  };

  // Format time display
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs
      .toString()
      .padStart(2, "0")}`;
  };

  // Toggle listening state
  const handleToggleListening = () => {
    if (isListening) {
      stopRealtimeSession();
    } else {
      startRealtimeSession();
    }
  };

  // Clean up on unmount
  useEffect(() => {
    return () => {
      stopRealtimeSession();
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, []);

  return (
    <div className={cn("w-full py-4", className)}>
      <div className="relative max-w-xl w-full mx-auto flex items-center flex-col gap-2">
        <button
          className={cn(
            "group w-16 h-16 rounded-xl flex items-center justify-center transition-colors",
            isListening
              ? "border bg-[#f5a96b]"
              : isConnecting
              ? "border bg-gray-400 cursor-not-allowed"
              : "border bg-[#6268eb] hover:bg-[#f5a96b]",
            disabled && "opacity-50 cursor-not-allowed"
          )}
          type="button"
          onClick={handleToggleListening}
          disabled={isConnecting || disabled}
        >
          {isConnecting ? (
            <div
              className="w-6 h-6 rounded-sm animate-spin bg-black cursor-pointer pointer-events-auto"
              style={{ animationDuration: "1s" }}
            />
          ) : isListening ? (
            <MicOff className="w-6 h-6 text-white" />
          ) : (
            <Mic className="w-6 h-6 text-white" />
          )}
        </button>

        <span
          className={cn(
            "font-mono text-sm transition-opacity duration-300",
            isListening
              ? "text-black/70 dark:text-white/70"
              : "text-black/30 dark:text-white/30"
          )}
        >
          {formatTime(time)}
        </span>

        <div className="h-4 w-64 flex items-center justify-center gap-0.5">
          {[...Array(visualizerBars)].map((_, i) => (
            <div
              key={i}
              className={cn(
                "w-0.5 rounded-full transition-all duration-300",
                isListening
                  ? "bg-black/50 dark:bg-white/50 animate-pulse"
                  : "bg-black/10 dark:bg-white/10 h-1"
              )}
              style={
                isListening
                  ? {
                      height: `${20 + Math.random() * 80}%`,
                      animationDelay: `${i * 0.05}s`,
                    }
                  : undefined
              }
            />
          ))}
        </div>

        <p className="h-4 text-xs text-black/70 dark:text-white/70">
          {isListening
            ? "Speaking..."
            : isConnecting
            ? "Connecting..."
            : errorMessage || `Click to speak (${connectionStatus})`}
        </p>
      </div>
    </div>
  );
}
