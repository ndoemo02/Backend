# FreeFlow Cloud - System Intencji V2

Dokumentacja techniczna i plan implementacji nowego systemu obsługi intencji, zdarzeń i analityki.

## 1. Schemat Danych (PostgreSQL / Supabase)

Aby zrealizować wymaganie pełnego timeline'u ("od pierwszego kontaktu do finalnego zdarzenia"), wprowadzamy relacyjną strukturę danych opartą na `Conversations` i `Events`. Obecna tabela `amber_intents` zostanie zachowana jako "szybki log", ale głównym źródłem prawdy staną się nowe tabele.

### 1.1. Tabela `conversations`
Przechowuje stan całej sesji rozmowy.

| Kolumna | Typ | Opis |
|---|---|---|
| `id` | UUID | Primary Key (tożsame z `session_id` z frontendu lub nowe UUID) |
| `user_id` | UUID | Nullable, jeśli użytkownik zalogowany |
| `status` | VARCHAR | `active`, `completed`, `dropped`, `error` |
| `started_at` | TIMESTAMPTZ | Czas rozpoczęcia |
| `ended_at` | TIMESTAMPTZ | Czas zakończenia (ostatniej aktywności) |
| `metadata` | JSONB | Dodatkowe dane (np. `restaurant_id`, `device_info`) |
| `summary` | TEXT | Podsumowanie rozmowy (generowane przez LLM po zakończeniu) |

### 1.2. Tabela `conversation_events`
Loguje każde atomowe zdarzenie w ramach rozmowy.

| Kolumna | Typ | Opis |
|---|---|---|
| `id` | BIGINT | Auto-increment PK |
| `conversation_id` | UUID | FK do `conversations.id` |
| `step_order` | INT | Numer kolejny kroku w rozmowie |
| `event_type` | VARCHAR | `voice_start`, `transcription_done`, `intent_detected`, `action_executed`, `reply_generated` |
| `payload` | JSONB | Szczegóły (np. rozpoznany tekst, parametry intencji, treść odpowiedzi) |
| `confidence` | FLOAT | Pewność (dla intencji) |
| `created_at` | TIMESTAMPTZ | Czas zdarzenia |

## 2. Definicja Intencji (Core Intents)

Zmapowanie wymagań na istniejący/nowy kod:

| Intent Name | Opis | Payload (Entities) |
|---|---|---|
| `search_restaurants` | Szukanie miejsc | `{ location, cuisine, sort }` |
| `select_restaurant` | Wybór lokalu | `{ restaurant_id, name }` |
| `ask_for_menu` | Pytanie o kartę | `{ category }` |
| `order_item` | Dodanie do koszyka | `{ item_name, quantity, variants, modifications }` |
| `modify_order` | Zmiana zamówienia | `{ item_id, change_type, new_value }` |
| `remove_item` | Usunięcie z zam. | `{ item_id/name }` |
| `confirm_order` | Finalizacja | `{ payment_method, delivery_address }` |
| `reserve_table` | Rezerwacja | `{ date, time, pax }` |
| `ask_for_availability` | Pytanie o termin | `{ date, time }` |
| `cancel_action` | Anulowanie ost. akcji | - |
| `fallback` | Niezrozumienie | `{ raw_input, reason }` |
| `end_conversation` | Koniec | - |

## 3. Flow Backendowy (Brain Router V2)

Przepływ w `brainRouter.js` zostanie wzbogacony o `EventLogService` (asynchroniczny).

1.  **Request Start:** Otrzymanie requestu -> `Log(conversation_id, 'voice_start'/'text_input', { text })`.
2.  **Intent Detection:**
    *   Classic/Rule-based -> `Log(..., 'intent_detected', { source: 'classic', intent, confidence })`.
    *   LLM Fallback -> `Log(..., 'intent_detected', { source: 'llm', intent, confidence })`.
3.  **Action Execution:** Wykonanie logiki biznesowej (np. szukanie w bazie) -> `Log(..., 'action_executed', { result_count, status })`.
4.  **Reply Generation:** Wygenerowanie odpowiedzi (Text/TTS) -> `Log(..., 'reply_generated', { text, audio_url })`.
5.  **Response:** Wysłanie odpowiedzi do klienta.

To wszystko dzieje się `fire-and-forget` (nie blokuje odpowiedzi do użytkownika).

## 4. Endpointy API

### `POST /api/events` (Internal/Frontend)
Endpoint do zgłaszania zdarzeń bezpośrednio z frontendu (np. `voice_start`, `transcription_done` z latency), aby backend miał pełny obraz timeline'u.

### `GET /api/admin/conversations`
Lista rozmów z filtrowaniem i paginacją.

### `GET /api/admin/conversations/:id`
Pełny timeline rozmowy (join `conversations` + `conversation_events`).

## 5. Integracja z Panelem Admina

Panel Admina otrzyma nową zakładkę "Conversations" (Brain/Learning), gdzie zwizualizowany zostanie timeline:
- Oś czasu wertykalna.
- Kolory oznaczające typ zdarzenia (zielony: sukces, żółty: low confidence, czerwony: error).
- Możliwość rozwinięcia payloadu JSON każdego kroku.

## 6. Plan Implementacji

1.  Utworzenie migracji SQL (`migrations/002_intent_system_v2.sql`).
2.  Implementacja serwisu logowania `EventLogger` w backendzie.
3.  Wpięcie `EventLogger` w kluczowe miejsca `brainRouter.js`.
4.  Stworzenie endpointów API Admina.
