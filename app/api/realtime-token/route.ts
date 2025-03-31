import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  try {
    // Request an ephemeral token from OpenAI
    const response = await fetch(
      "https://api.openai.com/v1/realtime/sessions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
          "OpenAI-Beta": "realtime=v1",
        },
        body: JSON.stringify({
          model: "gpt-4o-realtime-preview-2024-12-17",
          voice: "alloy",
        }),
      }
    );

    if (!response.ok) {
      console.error("OpenAI API error:", response.status);
      return NextResponse.json(
        { error: `Failed to get token: ${response.statusText}` },
        { status: response.status }
      );
    }

    const data = await response.json();

    // Ensure the token is in the response
    if (!data.client_secret || !data.client_secret.value) {
      console.error("Invalid token response format");
      return NextResponse.json(
        { error: "Invalid token response from OpenAI" },
        { status: 500 }
      );
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("Error creating realtime session:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 }
    );
  }
}
