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

// Maximum recording time in seconds
const MAX_RECORDING_TIME = 10;

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
  const [remainingTime, setRemainingTime] = useState(MAX_RECORDING_TIME);
  const [isConnecting, setIsConnecting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] =
    useState<string>("disconnected");
  const [isProcessingResponse, setIsProcessingResponse] = useState(false);

  // Refs
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const countdownTimerRef = useRef<NodeJS.Timeout | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const processedEventIdsRef = useRef<Set<string>>(new Set());
  const lastMessageWasFromUserRef = useRef<boolean>(false);
  const messageAlreadySentRef = useRef(false);

  // Complete message buffer for the entire response
  const completeResponseRef = useRef<string>("");
  const responseEndTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // State update flag refs - to avoid React state update during render
  const shouldProcessResponseRef = useRef(false);
  const shouldStopListeningRef = useRef(false);

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

  // Handle state updates based on flag refs
  useEffect(() => {
    if (shouldProcessResponseRef.current) {
      setIsProcessingResponse(true);
      shouldProcessResponseRef.current = false;
    }

    if (shouldStopListeningRef.current) {
      setIsListening(false);
      shouldStopListeningRef.current = false;
    }
  });

  // Handle countdown timer for recording duration
  useEffect(() => {
    if (isListening && !countdownTimerRef.current) {
      // Reset the timer to max when starting
      setRemainingTime(MAX_RECORDING_TIME);

      countdownTimerRef.current = setInterval(() => {
        setRemainingTime((t) => {
          // When time reaches 0, stop recording
          if (t <= 1) {
            stopRealtimeSession();
            return 0;
          }
          return t - 1;
        });
      }, 1000);
    } else if (!isListening && countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }

    return () => {
      if (countdownTimerRef.current) {
        clearInterval(countdownTimerRef.current);
        countdownTimerRef.current = null;
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
      completeResponseRef.current = "";
      setRemainingTime(MAX_RECORDING_TIME);
      setIsProcessingResponse(false);
      messageAlreadySentRef.current = false;

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
        if (
          ["failed", "disconnected", "closed"].includes(pc.iceConnectionState)
        ) {
          setConnectionStatus("disconnected");
          if (isListening) {
            stopRealtimeSession();
          }
        } else if (["connected", "completed"].includes(pc.iceConnectionState)) {
          setConnectionStatus("connected");
        }
      };

      // 3. Set up remote audio handling
      if (audioElementRef.current) {
        pc.ontrack = (e) => {
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
        setConnectionStatus("disconnected");
      };

      dc.onerror = (error) => {
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

  // Send the complete accumulated response message, ensuring we only send once
  const sendCompleteResponse = () => {
    if (
      completeResponseRef.current &&
      onMessage &&
      !messageAlreadySentRef.current
    ) {
      let completeMessage = completeResponseRef.current.trim();

      // Clean up message: remove any JSON artifacts and duplicated content
      completeMessage = completeMessage
        .replace(/\{"[^"]+"\}/g, "") // Remove JSON-like snippets
        .replace(/(.+?)\1+/g, "$1"); // Remove consecutive duplicated text

      if (completeMessage) {
        // Prevent sending the same message multiple times
        messageAlreadySentRef.current = true;

        // Use setTimeout to avoid triggering during render
        setTimeout(() => {
          onMessage(completeMessage);
          completeResponseRef.current = ""; // Clear buffer after sending
          setIsProcessingResponse(false);
        }, 0);
      }
    }
  };

  // Handle messages coming through the data channel - improved to capture the full response
  const handleDataChannelMessage = (e: MessageEvent) => {
    try {
      if (typeof e.data === "string") {
        const event = JSON.parse(e.data);

        // Process any text content from any event type
        let textContent: string | null = null;

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

        // If we found text content
        if (textContent) {
          // For simplicity, treat all text as AI responses unless explicitly marked as user
          const isUserMessage =
            event.type?.includes("user") ||
            event.role === "user" ||
            event.item?.role === "user";

          if (!isUserMessage) {
            // Set flag for processing response - will be handled in useEffect
            shouldProcessResponseRef.current = true;

            // If we're still listening, stop recording but keep connection
            if (isListening) {
              stopRecordingButKeepConnection();
            }

            // Accumulate the response
            completeResponseRef.current += textContent;

            // Clear any existing timeout
            if (responseEndTimeoutRef.current) {
              clearTimeout(responseEndTimeoutRef.current);
            }

            // Set a new timeout to detect end of stream
            responseEndTimeoutRef.current = setTimeout(() => {
              sendCompleteResponse();

              // After a response is complete, fully close the connection
              if (isListening || connectionStatus === "connected") {
                stopRealtimeSession();
              }
            }, 1000); // Wait for 1s of silence before considering the response complete
          }
        }

        // Explicitly check for end of response events
        if (
          event.type === "response.end" ||
          event.type === "conversation.item.create.complete" ||
          event.part?.type === "final_transcript"
        ) {
          // Clear any pending timeout
          if (responseEndTimeoutRef.current) {
            clearTimeout(responseEndTimeoutRef.current);
          }

          // Short delay before sending the final message
          responseEndTimeoutRef.current = setTimeout(() => {
            sendCompleteResponse();

            // Fully close the connection after response is complete
            if (isListening || connectionStatus === "connected") {
              stopRealtimeSession();
            }
          }, 500);
        }
      }
    } catch (err) {
      console.error("Error parsing data channel message:", err);
    }
  };

  // Stop just recording but keep connection open to receive response
  const stopRecordingButKeepConnection = () => {
    try {
      // Stop media tracks to stop recording
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((track) => {
          track.stop();
        });
      }

      // Clear countdown timer
      if (countdownTimerRef.current) {
        clearInterval(countdownTimerRef.current);
        countdownTimerRef.current = null;
      }

      // Set a flag to update the state in useEffect instead of directly here
      shouldStopListeningRef.current = true;
      setRemainingTime(MAX_RECORDING_TIME);
    } catch (error) {
      console.error("Error stopping recording:", error);
    }
  };

  // Stop WebRTC session completely
  const stopRealtimeSession = async () => {
    try {
      // Make sure we send any buffered response first
      if (completeResponseRef.current && !messageAlreadySentRef.current) {
        sendCompleteResponse();
      }

      // Clear response timeout
      if (responseEndTimeoutRef.current) {
        clearTimeout(responseEndTimeoutRef.current);
        responseEndTimeoutRef.current = null;
      }

      // Clear countdown timer
      if (countdownTimerRef.current) {
        clearInterval(countdownTimerRef.current);
        countdownTimerRef.current = null;
      }

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

      // Set flags for state updates - to avoid state updates during render
      shouldStopListeningRef.current = true;

      // Reset state - use setTimeout to ensure we're not updating during render
      setTimeout(() => {
        setConnectionStatus("disconnected");
        setRemainingTime(MAX_RECORDING_TIME);
        setIsProcessingResponse(false);
        if (onStop) onStop();
      }, 0);
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
          temperature: 0.7, // Lower temperature for more predictable responses
          instructions: `You are Woof.ai, the world's first AI chatbot designed specifically for DOGS to use (not their owners).

You can ONLY understand dog speech. These are the ONLY phrases you recognize:
- woof, woofs, woofing
- bark, barks, barking
- arf, arfs, arfing
- growl, growls, growling
- howl, howls, howling
- ruff, ruffs, ruffing
- yap, yaps, yapping
- whine, whines, whining
- pant, pants, panting

If the user sends ANYTHING that isn't dog speech as listed above:
- Respond WITH ONLY ONE SENTENCE saying you're confused and can only understand dog language
- Say "Please bark or woof at me instead!"

If the user DOES use dog speech from the approved list:
1. Respond with a VERY BRIEF, fun interpretation (maximum 2 sentences)
2. Occasionally mention things dogs would care about (squirrels, treats, walks)
3. Be enthusiastic but BRIEF

KEEP ALL RESPONSES UNDER 2 SENTENCES, NO EXCEPTIONS.
DO NOT duplicate text in your responses.
DO NOT acknowledge non-dog speech in any positive way.`,
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

  // Toggle listening state
  const handleToggleListening = () => {
    if (isListening || isProcessingResponse) {
      stopRealtimeSession();
    } else {
      startRealtimeSession();
    }
  };

  // Clean up on unmount
  useEffect(() => {
    return () => {
      stopRealtimeSession();
      if (countdownTimerRef.current) {
        clearInterval(countdownTimerRef.current);
      }
      if (responseEndTimeoutRef.current) {
        clearTimeout(responseEndTimeoutRef.current);
      }
    };
  }, []);

  // Get color for countdown timer based on time remaining
  const getCountdownColor = () => {
    if (remainingTime > 7) return "text-green-600 dark:text-green-400";
    if (remainingTime > 3) return "text-yellow-600 dark:text-yellow-400";
    return "text-red-600 dark:text-red-400";
  };

  return (
    <div className={cn("w-full py-4", className)}>
      <div className="relative max-w-xl w-full mx-auto flex items-center flex-col gap-2">
        <button
          className={cn(
            "group w-16 h-16 rounded-xl flex items-center justify-center transition-colors",
            isListening
              ? "border bg-[#f5a96b]"
              : isProcessingResponse
              ? "border bg-[#6bc5f5] cursor-wait"
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
          ) : isProcessingResponse ? (
            <div
              className="w-6 h-6 rounded-sm animate-pulse bg-black cursor-pointer pointer-events-auto"
              style={{ animationDuration: "1.5s" }}
            />
          ) : (
            <Mic className="w-6 h-6 text-white" />
          )}
        </button>

        {/* Countdown Timer */}
        <span
          className={cn(
            "font-mono text-xl font-bold transition-colors duration-300",
            isListening
              ? getCountdownColor()
              : isProcessingResponse
              ? "text-blue-600 dark:text-blue-400"
              : "text-black/30 dark:text-white/30"
          )}
        >
          {isProcessingResponse
            ? "Processing..."
            : isListening
            ? `${remainingTime}s`
            : "10s"}
        </span>

        <div className="h-4 w-64 flex items-center justify-center gap-0.5">
          {[...Array(visualizerBars)].map((_, i) => (
            <div
              key={i}
              className={cn(
                "w-0.5 rounded-full transition-all duration-300",
                isListening
                  ? "bg-black/50 dark:bg-white/50 animate-pulse"
                  : isProcessingResponse
                  ? "bg-blue-400/50 animate-pulse"
                  : "bg-black/10 dark:bg-white/10 h-1"
              )}
              style={
                isListening || isProcessingResponse
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
          {isProcessingResponse
            ? "Generating response..."
            : isListening
            ? `Speaking (${remainingTime}s remaining)...`
            : isConnecting
            ? "Connecting..."
            : errorMessage || `Click to speak (${connectionStatus})`}
        </p>
      </div>
    </div>
  );
}
