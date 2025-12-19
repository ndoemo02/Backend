# TTS (Text-to-Speech) Integration

## Przegląd

Freeflow został zintegrowany z Google Cloud Text-to-Speech API, umożliwiając syntezę mowy w języku polskim dla asystenta głosowego.

## Funkcjonalności

### 🎤 Obsługiwane głosy polskie

- **Wavenet (wysokiej jakości)**:
  - `pl-PL-Wavenet-A` - Kobieta
  - `pl-PL-Wavenet-B` - Mężczyzna  
  - `pl-PL-Wavenet-C` - Kobieta 2
  - `pl-PL-Wavenet-D` - Mężczyzna 2

- **Standard (podstawowa jakość)**:
  - `pl-PL-Standard-A` - Kobieta
  - `pl-PL-Standard-B` - Mężczyzna
  - `pl-PL-Standard-C` - Kobieta 2
  - `pl-PL-Standard-D` - Mężczyzna 2

### 🎛️ Opcje konfiguracji

- **Język**: `pl-PL` (domyślny)
- **Formaty audio**: MP3, LINEAR16, OGG_OPUS
- **Parametry głosu**:
  - `speakingRate`: Szybkość mowy (0.25 - 4.0)
  - `pitch`: Wysokość głosu (-20.0 - 20.0)
  - `volumeGainDb`: Głośność (-96.0 - 16.0)

## Architektura

### Backend (`freeflow-backend`)

```
/api/tts (POST)
├── Google Cloud TTS Client
├── Obsługa uwierzytelniania
├── Konfiguracja głosów polskich
└── Zwracanie audio w base64
```

**Endpoint**: `POST /api/tts`

**Request**:
```json
{
  "text": "Tekst do syntezy",
  "lang": "pl-PL",
  "voiceName": "pl-PL-Wavenet-A",
  "gender": "FEMALE",
  "audioEncoding": "MP3",
  "speakingRate": 1.0,
  "pitch": 0.0,
  "volumeGainDb": 0.0
}
```

**Response**:
```json
{
  "ok": true,
  "audioContent": "base64_encoded_audio",
  "audioEncoding": "MP3",
  "voice": "pl-PL-Wavenet-A",
  "language": "pl-PL",
  "textLength": 42
}
```

### Frontend (`classic-ui-app2`)

```
src/lib/ttsClient.ts
├── speakTts() - główna funkcja
├── speakWithVoice() - z określonym głosem
├── speakWithGender() - z preferencją płci
├── POLISH_VOICES - dostępne głosy
└── Obsługa środowisk (dev/prod)
```

## Użycie

### Podstawowe użycie

```typescript
import { speakTts } from '../lib/ttsClient';

// Proste użycie
await speakTts("Witaj w Freeflow!");

// Z opcjami
await speakTts("Dodałem do koszyka", {
  voiceName: "pl-PL-Wavenet-B",
  speakingRate: 1.2
});
```

### Użycie z określonym głosem

```typescript
import { speakWithVoice } from '../lib/ttsClient';

await speakWithVoice("Zamówienie złożone", "pl-PL-Wavenet-D");
```

### Użycie z preferencją płci

```typescript
import { speakWithGender } from '../lib/ttsClient';

await speakWithGender("Dziękuję za zamówienie", "FEMALE");
```

## Konfiguracja środowiska

### Backend (Vercel)

Wymagane zmienne środowiskowe:
- `GOOGLE_APPLICATION_CREDENTIALS_JSON` - JSON credentials
- `GOOGLE_APPLICATION_CREDENTIALS_BASE64` - Base64 encoded credentials
- `GOOGLE_CREDENTIALS_PART1` + `GOOGLE_CREDENTIALS_PART2` - Split credentials

### Lokalny rozwój

1. Utwórz service account w Google Cloud Console
2. Pobierz plik JSON z kluczami
3. Umieść jako `service-account.json` w katalogu backend
4. Włącz Google Cloud Text-to-Speech API

## Testowanie

### Test backend

```bash
cd freeflow-backend
node test-tts.js
```

### Test frontend

```typescript
// W konsoli przeglądarki
import { speakTts } from './src/lib/ttsClient';
speakTts("Test syntezy mowy");
```

## Integracja z aplikacją

TTS jest używane w następujących miejscach:

1. **Potwierdzenia zamówień** - "Dodałem do koszyka"
2. **Finalizacja zamówienia** - "Zamówienie złożone. Dziękuję!"
3. **Odpowiedzi asystenta** - Dialogflow responses
4. **Komunikaty systemowe** - Status updates

## Optymalizacja

### Cache
- Frontend cache'uje ostatnie żądania TTS
- Deduplikacja identycznych tekstów

### Performance
- Asynchroniczne odtwarzanie audio
- Obsługa błędów bez blokowania UI
- Fallback na domyślny głos w przypadku błędów

## Rozwiązywanie problemów

### Błędy uwierzytelniania
```
Error: Permission denied (code: 7)
```
**Rozwiązanie**: Sprawdź Google Cloud credentials

### Błędy quota
```
Error: Resource exhausted (code: 8)
```
**Rozwiązanie**: Sprawdź limity TTS w Google Cloud Console

### Błędy parametrów
```
Error: Invalid argument (code: 3)
```
**Rozwiązanie**: Sprawdź poprawność tekstu i parametrów głosu

## Koszty

Google Cloud TTS cennik (2024):
- **Wavenet**: $16 za 1M znaków
- **Standard**: $4 za 1M znaków
- **WaveNet Neural2**: $20 za 1M znaków

Dla typowego użycia w aplikacji (krótkie komunikaty):
- ~100 znaków na komunikat
- ~1000 komunikatów/miesiąc
- Koszt: ~$0.16/miesiąc (Wavenet)

## Przyszłe rozszerzenia

1. **SSML Support** - Zaawansowane formatowanie mowy
2. **Voice Cloning** - Własne głosy
3. **Emotion Control** - Kontrola emocji w głosie
4. **Multi-language** - Wsparcie innych języków
5. **Offline TTS** - Lokalna synteza mowy
