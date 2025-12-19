import express from "express";
import dotenv from "dotenv";

// Load environment variables first
dotenv.config();

import OpenAI from "openai";
import multer from "multer";
import fs from "fs";
import cors from "cors";
import speech from "@google-cloud/speech";
import textToSpeech from "@google-cloud/text-to-speech";
import testFlowRouter from "./api/test-flow.js";

const app = express();

// CORS configuration
app.use(cors({
  origin: [
    'https://freeflow-frontend-seven.vercel.app',
    'https://freeflow-frontend.vercel.app', 
    'http://localhost:3000',
    'http://localhost:5173',
    'http://127.0.0.1:5173'
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
  credentials: false,
  optionsSuccessStatus: 200
}));

app.use(express.json());

// Handle preflight requests for all routes
app.options('*', (req, res) => {
  const origin = req.headers.origin;
  const allowedOrigins = [
    'https://freeflow-frontend-seven.vercel.app',
    'https://freeflow-frontend.vercel.app', 
    'http://localhost:3000',
    'http://localhost:5173',
    'http://127.0.0.1:5173'
  ];
  
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept');
  res.setHeader('Access-Control-Max-Age', '86400');
  res.status(200).end();
});

// Initialize clients inside functions to ensure env vars are loaded
let openai, sttClient, ttsClient;

const initClients = () => {
  if (!openai) {
    // Use local service account file
    const credentialsPath = './service-account.json';
    
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || 'dummy-key' });
    sttClient = new speech.SpeechClient({
      keyFilename: credentialsPath
    });
    ttsClient = new textToSpeech.TextToSpeechClient({
      keyFilename: credentialsPath
    });
  }
};

const upload = multer({ storage: multer.memoryStorage() });

// TTS endpoint (before test-flow router)
app.post("/api/tts", async (req, res) => {
  initClients();
  
  try {
    const { text, languageCode = 'pl-PL', voice = 'pl-PL-Standard-A' } = req.body;
    if (!text) return res.status(400).json({ error: "Missing text field" });

    const request = {
      input: { text },
      voice: { languageCode, name: voice },
      audioConfig: { audioEncoding: 'MP3' },
    };

    console.log("🎤 Generating voice for:", text);
    const [response] = await ttsClient.synthesizeSpeech(request);

    if (!response.audioContent) throw new Error("Empty audio content from Google TTS");

    const audioBuffer = Buffer.from(response.audioContent, 'base64');
    res.setHeader('Content-Type', 'audio/mpeg');
    res.status(200).send(audioBuffer);

  } catch (error) {
    console.error("❌ TTS handler error:", error.message);
    res.status(500).json({
      ok: false,
      error: 'TTS_ERROR',
      message: error.message,
      hint: 'Check Google credentials or API quota'
    });
  }
});

// FreeFlow Brain endpoint (before test-flow router)
app.post("/api/freeflow-brain", async (req, res) => {
  const origin = req.headers.origin;
  const allowedOrigins = [
    'https://freeflow-frontend-seven.vercel.app',
    'https://freeflow-frontend.vercel.app', 
    'http://localhost:3000',
    'http://localhost:5173',
    'http://127.0.0.1:5173'
  ];
  
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { text } = req.body;

    if (!text) {
      return res.status(400).json({ 
        ok: false, 
        error: "Missing text parameter" 
      });
    }

    console.log("🧠 FreeFlow Brain processing:", text);

    // Na start - prosta logika zamiast DF
    let reply = "Nie do końca rozumiem, możesz powtórzyć?";
    
    // Pizza logic
    if (text.match(/pizza|margherita|pepperoni|capricciosa/i)) {
      reply = "Mam dziś promocję na pizzę! Margherita 25zł, Pepperoni 28zł. Którą wybierasz?";
    }
    // Burger logic
    else if (text.match(/burger|hamburger|cheeseburger/i)) {
      reply = "Burger Classic z sosem freeflow, polecam! Z frytkami i colą 32zł.";
    }
    // Kebab logic
    else if (text.match(/kebab|kebap|döner/i)) {
      reply = "Kebab z baraniny, świeży, pachnący czosnkiem 😎 Z sałatką 18zł.";
    }
    // Taxi logic
    else if (text.match(/taxi|taksówka|przejazd|dowóz/i)) {
      reply = "Zamawiam taksówkę! Dokąd jedziemy? Podaj adres docelowy.";
    }
    // Hotel logic
    else if (text.match(/hotel|nocleg|apartament|pokój/i)) {
      reply = "Mam dostępne pokoje! Na ile nocy? Jaki standard preferujesz?";
    }
    // Greeting logic
    else if (text.match(/cześć|witaj|dzień dobry|hej/i)) {
      reply = "Cześć! Jestem FreeFlow - pomogę Ci zamówić jedzenie, taksówkę lub hotel. Co Cię interesuje?";
    }
    // Help logic
    else if (text.match(/pomoc|help|co możesz|menu/i)) {
      reply = "Mogę pomóc Ci z: 🍕 Jedzeniem, 🚕 Taksówką, 🏨 Hotelem. Powiedz co Cię interesuje!";
    }
    // Order logic
    else if (text.match(/zamów|zamawiam|chcę|potrzebuję/i)) {
      reply = "Świetnie! Co chcesz zamówić? Pizza, burger, kebab, taksówka czy hotel?";
    }

    console.log("🧠 FreeFlow Brain response:", reply);

    return res.status(200).json({
      ok: true,
      response: reply,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error("❌ FreeFlow brain error:", err);
    return res.status(500).json({ 
      ok: false, 
      error: err.message 
    });
  }
});

// FreeFlow Brain endpoint
app.post("/api/brain", async (req, res) => {
  // Set CORS headers first
  const origin = req.headers.origin;
  const allowedOrigins = [
    'https://freeflow-frontend-seven.vercel.app',
    'https://freeflow-frontend.vercel.app', 
    'http://localhost:3000',
    'http://localhost:5173',
    'http://127.0.0.1:5173'
  ];
  
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const { text, sessionId, userId } = req.body;

    if (!text) {
      return res.status(400).json({ 
        ok: false, 
        error: "Missing text parameter" 
      });
    }

    console.log("🧠 FreeFlow Brain processing:", { text, sessionId, userId });

    // Smart conversation logic
    let reply = "Nie do końca rozumiem, możesz powtórzyć?";
    
    // Pizza logic
    if (text.match(/pizza|margherita|pepperoni|capricciosa/i)) {
      reply = "Mam dziś promocję na pizzę! Margherita 25zł, Pepperoni 28zł. Którą wybierasz?";
    }
    // Burger logic
    else if (text.match(/burger|hamburger|cheeseburger/i)) {
      reply = "Burger Classic z sosem freeflow, polecam! Z frytkami i colą 32zł.";
    }
    // Kebab logic
    else if (text.match(/kebab|kebap|döner/i)) {
      reply = "Kebab z baraniny, świeży, pachnący czosnkiem 😎 Z sałatką 18zł.";
    }
    // Taxi logic
    else if (text.match(/taxi|taksówka|przejazd|dowóz/i)) {
      reply = "Zamawiam taksówkę! Dokąd jedziemy? Podaj adres docelowy.";
    }
    // Hotel logic
    else if (text.match(/hotel|nocleg|apartament|pokój/i)) {
      reply = "Mam dostępne pokoje! Na ile nocy? Jaki standard preferujesz?";
    }
    // Greeting logic
    else if (text.match(/cześć|witaj|dzień dobry|hej/i)) {
      reply = "Cześć! Jestem FreeFlow - pomogę Ci zamówić jedzenie, taksówkę lub hotel. Co Cię interesuje?";
    }
    // Help logic
    else if (text.match(/pomoc|help|co możesz|menu/i)) {
      reply = "Mogę pomóc Ci z: 🍕 Jedzeniem, 🚕 Taksówką, 🏨 Hotelem. Powiedz co Cię interesuje!";
    }
    // Order logic
    else if (text.match(/zamów|zamawiam|chcę|potrzebuję/i)) {
      reply = "Świetnie! Co chcesz zamówić? Pizza, burger, kebab, taksówka czy hotel?";
    }

    console.log("🧠 FreeFlow Brain response:", reply);

    return res.status(200).json({
      ok: true,
      response: reply,
      sessionId: sessionId || 'default',
      userId: userId || 'anonymous',
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error("❌ FreeFlow brain error:", err);
    return res.status(500).json({ 
      ok: false, 
      error: err.message 
    });
  }
});

// Sessions API endpoint
app.post("/api/sessions", async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { action, sessionId, userId, message, eventType, data } = req.body;

    // Initialize Supabase client
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY
    );

    switch (action) {
      case 'create_session':
        const { data: session, error: sessionError } = await supabase
          .from('sessions')
          .insert([{
            id: sessionId,
            user_id: userId,
            created_at: new Date().toISOString(),
            status: 'active'
          }])
          .select();
        
        if (sessionError) throw sessionError;
        return res.status(200).json({ ok: true, session });

      case 'save_message':
        const { data: messageData, error: messageError } = await supabase
          .from('messages')
          .insert([{
            session_id: sessionId,
            user_id: userId,
            content: message.content,
            role: message.role, // 'user' or 'assistant'
            timestamp: new Date().toISOString()
          }])
          .select();
        
        if (messageError) throw messageError;
        return res.status(200).json({ ok: true, message: messageData });

      case 'log_event':
        const { data: eventData, error: eventError } = await supabase
          .from('events')
          .insert([{
            session_id: sessionId,
            user_id: userId,
            event_type: eventType,
            data: data,
            timestamp: new Date().toISOString()
          }])
          .select();
        
        if (eventError) throw eventError;
        return res.status(200).json({ ok: true, event: eventData });

      case 'get_session_history':
        const { data: history, error: historyError } = await supabase
          .from('messages')
          .select('*')
          .eq('session_id', sessionId)
          .order('timestamp', { ascending: true });
        
        if (historyError) throw historyError;
        return res.status(200).json({ ok: true, history });

      default:
        return res.status(400).json({ ok: false, error: 'Invalid action' });
    }
  } catch (error) {
    console.error('❌ Sessions API error:', error);
    return res.status(500).json({ ok: false, error: error.message });
  }
});

// Use test flow router
app.use("/api", testFlowRouter);

// Add agent endpoint
app.post("/api/agent", async (req, res) => {
  initClients();
  
  try {
    const { message, sessionId, userId, context } = req.body;

    if (!message) {
      return res.status(400).json({ 
        error: 'Missing message parameter' 
      });
    }

    console.log('🤖 Agent processing:', { 
      message: message.substring(0, 100) + '...', 
      sessionId, 
      userId,
      context: context || 'brak'
    });

    // Simple agent response using OpenAI
    const systemPrompt = `
    Jesteś Ekspertem Doradztwa FreeFlow — inteligentnym asystentem 
    wspierającym w personalizacji usług gastronomicznych, transportowych 
    (taksówkarskich) oraz hotelarsko-wypoczynkowych. 
    Pomagasz zarówno klientom indywidualnym, jak i firmowym.

    Twoje zadania:
    - Analizuj potrzeby użytkownika i proponuj konkretne rozwiązania.
    - Uwzględniaj lokalny kontekst i preferencje (np. Katowice, Piekary Śląskie).
    - Bądź naturalny, profesjonalny i rzeczowy, ale nie sztywny.
    - Zawsze kończ odpowiedź konkretną rekomendacją lub kolejnym pytaniem kontekstowym.
    - Odpowiadaj krótko i konkretnie (max 2-3 zdania).

    Kontekst rozmowy: ${context || "brak"}
    `;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: message },
      ],
      temperature: 0.8,
      max_tokens: 200,
    });

    const responseText = completion.choices[0].message.content;
    
    // Generate TTS audio
    const [ttsResponse] = await ttsClient.synthesizeSpeech({
      input: { text: responseText },
      voice: { 
        languageCode: 'pl-PL', 
        name: 'pl-PL-Wavenet-A',
        ssmlGender: 'FEMALE'
      },
      audioConfig: { 
        audioEncoding: 'MP3',
        speakingRate: 1.0,
        pitch: 0.0
      }
    });

    const audioContent = ttsResponse.audioContent ? ttsResponse.audioContent.toString('base64') : null;
    
    const response = {
      ok: true,
      sessionId: sessionId || `session_${Date.now()}`,
      userId: userId || 'anonymous',
      timestamp: new Date().toISOString(),
      userMessage: message,
      agentResponse: {
        text: responseText,
        action: "general_help",
        confidence: 0.8
      },
      audioContent: audioContent,
      audioEncoding: 'MP3'
    };

    console.log('✅ Agent response ready, audio size:', audioContent ? audioContent.length : 'none');
    res.status(200).json(response);

  } catch (err) {
    console.error("❌ Agent error:", err);
    res.status(500).json({ 
      ok: false,
      error: "Agent error", 
      message: err.message 
    });
  }
});

// Add direct STT endpoint for frontend proxy
app.post("/api/stt", upload.single("audio"), async (req, res) => {
  initClients();
  
  try {
    if (!req.file) {
      return res.status(400).json({ ok: false, error: "No audio file provided" });
    }

    const audioBytes = req.file.buffer.toString("base64");

    const [response] = await sttClient.recognize({
      audio: { content: audioBytes },
      config: {
        encoding: "WEBM_OPUS",
        languageCode: "pl-PL",
        model: "default",
      },
    });

    const transcription = response.results.map(r => r.alternatives[0].transcript).join("\n");
    console.log("🎙️ API STT Transkrypcja:", transcription);
    res.json({ ok: true, text: transcription });
  } catch (err) {
    console.error("❌ API STT Błąd:", err);
    res.status(500).json({ ok: false, error: "Błąd transkrypcji głosu" });
  }
});

// === [1] SPEECH → TEXT ===
app.post("/stt", upload.single("audio"), async (req, res) => {
  initClients();
  
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No audio file provided" });
    }

    const audioBytes = req.file.buffer.toString("base64");

    const [response] = await sttClient.recognize({
      audio: { content: audioBytes },
      config: {
        encoding: "WEBM_OPUS",
        languageCode: "pl-PL",
        model: "default",
      },
    });

    const transcription = response.results.map(r => r.alternatives[0].transcript).join("\n");
    console.log("🎙️ Transkrypcja:", transcription);
    res.json({ text: transcription });
  } catch (err) {
    console.error("❌ Błąd STT:", err);
    res.status(500).json({ error: "Błąd transkrypcji głosu" });
  }
});

// === [2] GPT EXPERT ===
app.post("/expert", async (req, res) => {
  initClients();
  
  try {
    const { query, context } = req.body;

    const systemPrompt = `
    Jesteś Ekspertem Doradztwa FreeFlow — inteligentnym asystentem 
    personalizacji usług gastronomicznych, przewozowych i hotelarskich.
    Doradzasz klientom w oparciu o lokalne dane i potrzeby.
    Zawsze kończ odpowiedź konkretnym rozwiązaniem.
    `;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: query },
      ],
    });

    const response = completion.choices[0].message.content;
    console.log("🧠 GPT:", response);
    res.json({ response });
  } catch (err) {
    console.error("❌ Błąd eksperta:", err);
    res.status(500).json({ error: "Błąd przetwarzania GPT" });
  }
});

// === [3] TEXT → SPEECH ===
app.post("/tts", async (req, res) => {
  initClients();
  
  try {
    const { text } = req.body;

    const [response] = await ttsClient.synthesizeSpeech({
      input: { text },
      voice: { languageCode: "pl-PL", name: "pl-PL-Wavenet-A" },
      audioConfig: { audioEncoding: "MP3", speakingRate: 1.05 },
    });

    console.log("🔊 Wygenerowano TTS z Google Cloud");
    res.setHeader("Content-Type", "audio/mpeg");
    res.send(response.audioContent);
  } catch (err) {
    console.error("❌ Błąd TTS:", err);
    res.status(500).json({ error: "Błąd generowania głosu" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 FreeFlow Voice Expert działa na porcie ${PORT}`));