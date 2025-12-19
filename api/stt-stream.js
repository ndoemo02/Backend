import WebSocket from "ws";
import { getVertexAccessToken } from "../utils/googleAuth.js";

export default async function handler(req, res) {
  try {
    console.log('🔴 STT Stream WebSocket request received');
    
    // Pobierz token dostępu
    const token = await getVertexAccessToken();
    
    // Utwórz WebSocket do Google Speech-to-Text
    const stt = new WebSocket("wss://speech.googleapis.com/v1p1beta1/speech:streamingRecognize", {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    stt.on("open", () => {
      console.log('🔴 Connected to Google STT streaming API');
      
      // Wyślij konfigurację
      stt.send(
        JSON.stringify({
          streamingConfig: {
            config: {
              encoding: "LINEAR16",
              sampleRateHertz: 44100,
              languageCode: "pl-PL",
              model: "latest_long",
              enableAutomaticPunctuation: true,
              enableWordTimeOffsets: true,
            },
            interimResults: true,
            singleUtterance: false,
          },
        })
      );
    });

    stt.on("message", (message) => {
      try {
        const data = JSON.parse(message.toString());
        console.log('🔴 STT response:', data);
        
        // Przekaż odpowiedź do klienta
        if (req.socket && req.socket.server) {
          req.socket.server.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
              client.send(JSON.stringify({
                transcript: data.results?.[0]?.alternatives?.[0]?.transcript || '',
                isFinal: data.results?.[0]?.isFinal || false,
                confidence: data.results?.[0]?.alternatives?.[0]?.confidence || 0
              }));
            }
          });
        }
      } catch (err) {
        console.error('🔴 Error parsing STT response:', err);
      }
    });

    stt.on("close", () => {
      console.log('🔴 Google STT WebSocket closed');
    });

    stt.on("error", (error) => {
      console.error('🔴 Google STT WebSocket error:', error);
    });

    // Obsługa połączeń klientów
    if (req.socket && req.socket.server) {
      req.socket.server.on("connection", (client) => {
        console.log('🔴 Client connected to STT stream');
        
        client.on("message", (msg) => {
          // Przekaż audio chunk do Google STT
          if (stt.readyState === WebSocket.OPEN) {
            stt.send(msg);
          }
        });

        client.on("close", () => {
          console.log('🔴 Client disconnected from STT stream');
        });

        client.on("error", (error) => {
          console.error('🔴 Client STT stream error:', error);
        });
      });
    }

    // Zwróć odpowiedź HTTP (WebSocket upgrade)
    res.writeHead(200, {
      'Upgrade': 'websocket',
      'Connection': 'Upgrade',
      'Sec-WebSocket-Accept': req.headers['sec-websocket-key']
    });
    res.end();

  } catch (err) {
    console.error('❌ STT Stream error:', err);
    res.status(500).json({ error: err.message });
  }
}
