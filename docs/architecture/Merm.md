sequenceDiagram
  participant U as User
  participant ASR as ASR (voice->text)
  participant API as /api/brain
  participant NLU as nlu/router
  participant PL as core/pipeline
  participant H as domains/food/*Handler
  participant DB as Supabase/SQL
  participant TTS as TTS (text->voice)

  U->>ASR: audio
  ASR->>API: text + turn_id + session_id
  API->>NLU: text
  NLU-->>API: intent+domain+entities+source
  API->>PL: nlu_result + session
  PL->>H: call handler(domain+intent)
  H->>DB: query/cache
  DB-->>H: data
  H-->>PL: handler_result (data,next,effects)
  PL-->>API: reply + session_updates
  API-->>TTS: reply (if voice)
  TTS-->>U: audio
