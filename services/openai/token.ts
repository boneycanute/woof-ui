/**
 * Service for retrieving ephemeral tokens from OpenAI realtime API
 * This service provides a clean interface for front-end components to get tokens
 * without needing to handle the API communication details
 */

/**
 * Retrieves an ephemeral token from the server for WebRTC connection with OpenAI
 * @returns {Promise<string>} The ephemeral token needed for realtime connections
 * @throws {Error} If the token retrieval fails
 */
export const getRealtimeToken = async (): Promise<string> => {
  try {
    // Call our backend API route that handles the token retrieval
    const response = await fetch("/api/realtime-token");

    if (!response.ok) {
      // If the server returns an error, format it and throw
      const error = await response.json();
      throw new Error(
        error.error || `Failed to get token: ${response.statusText}`
      );
    }

    // Parse the response and extract the token
    const data = await response.json();

    // Validate that we received a proper token
    if (!data.client_secret || !data.client_secret.value) {
      throw new Error("Invalid token format received from server");
    }

    // Return just the token value for simplicity
    return data.client_secret.value;
  } catch (error) {
    console.error("Token service error:", error);
    throw error;
  }
};
