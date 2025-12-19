# ❓ FAQ - Najczęściej zadawane pytania

## Ogólne

### Q: Dlaczego mono-API zamiast osobnych plików?
**A:** Vercel Trial ma limit **12 serverless functions**. Zamiast tworzyć 8 osobnych plików (8 functions), wszystkie endpointy są w jednym pliku (`/api/index.js`) = **tylko 1 function**. To pozwala zmieścić się w limicie i zostawia miejsce na przyszłe endpointy.

### Q: Czy to wpływa na performance?
**A:** Minimalnie. Wszystkie endpointy dzielą ten sam cold start, ale dla małych/średnich API różnica jest niewielka. Jeśli potrzebujesz lepszej izolacji, upgrade do Vercel Pro i rozdziel na osobne pliki.

### Q: Jak działa routing w mono-API?
**A:** 
```
User → /api/health
       ↓
vercel.json rewrite → /api/index/health
       ↓
/api/index.js → parse URL → wywołaj handleHealth()
```

## Deployment

### Q: Jak zdeployować na Vercel?
**A:** 3 sposoby:
1. **GitHub** (polecane): Połącz repo → auto-deploy przy każdym push
2. **Vercel CLI**: `vercel --prod`
3. **Drag & Drop**: Przeciągnij folder na vercel.com

Zobacz: [QUICK_START.md](./QUICK_START.md)

### Q: Jakie zmienne środowiskowe są wymagane?
**A:** 
- `SUPABASE_URL` - URL Supabase (lub użyj hardcoded w kodzie)
- `SUPABASE_ANON_KEY` - Klucz anon Supabase
- `GOOGLE_MAPS_API_KEY` - dla `/api/search` (opcjonalne)

### Q: Gdzie dodać zmienne środowiskowe?
**A:** 
1. Vercel Dashboard → Project Settings
2. Environment Variables
3. Dodaj zmienne (osobno dla Production, Preview, Development)

## Błędy

### Q: Dostaję 404 na `/api/health`, co robić?
**A:** Sprawdź:
1. Czy `vercel.json` jest w root projektu (nie w `/api`)
2. Czy `api/index.js` istnieje
3. Czy zrobiłeś re-deploy po zmianach
4. Zobacz deployment logs w Vercel Dashboard

### Q: Dostaję 500 Internal Server Error
**A:** 
1. Zobacz logi: Vercel Dashboard → Deployments → Functions → `/api/index`
2. Sprawdź czy zmienne środowiskowe są ustawione
3. Sprawdź czy Supabase jest dostępna
4. Zobacz `console.error` w logach

### Q: CORS errors w przeglądarce
**A:** Powinno działać out-of-the-box. Jeśli nie:
1. Sprawdź czy `vercel.json` ma sekcję `headers`
2. Sprawdź czy `setCors()` jest wywołane w `api/index.js`
3. Test: `curl -X OPTIONS https://your-app.vercel.app/api/health -v`

### Q: "Cannot find module" error
**A:** 
1. Sprawdź czy `package.json` ma `"type": "module"`
2. Wszystkie importy powinny mieć `.js` extension
3. Sprawdź czy dependencies są w `package.json`
4. Uruchom `npm install` lokalnie

## Endpointy

### Q: Jak dodać nowy endpoint?
**A:** 
1. Otwórz `api/index.js`
2. Dodaj nową funkcję handler (np. `handleNewEndpoint`)
3. Dodaj case w switch statement
4. Dodaj rewrite w `vercel.json`:
```json
{ "source": "/api/new", "destination": "/api/index/new" }
```

### Q: Które endpointy wymagają Supabase?
**A:** 
- `/api/restaurants` - lista restauracji
- `/api/menu` - menu restauracji
- `/api/orders` - zamówienia

Inne działają bez Supabase.

### Q: Jak testować endpointy lokalnie?
**A:**
```bash
# Uruchom serwer
npm start

# Test
curl http://localhost:3003/api/health
curl -X POST http://localhost:3003/api/nlu \
  -H "Content-Type: application/json" \
  -d '{"text": "test"}'
```

## Supabase

### Q: Gdzie wziąć klucze Supabase?
**A:** 
1. Idź na [supabase.com](https://supabase.com)
2. Wybierz projekt
3. Settings → API
4. Skopiuj `URL` i `anon public` key

### Q: Co jeśli nie mam Supabase?
**A:** Endpointy Supabase zwrócą błędy, ale reszta API działa:
- ✅ `/api/health`
- ✅ `/api/nlu`
- ✅ `/api/tts`
- ✅ `/api/search` (wymaga Google Maps)
- ❌ `/api/restaurants`
- ❌ `/api/menu`
- ❌ `/api/orders`

### Q: Jak skonfigurować Supabase tables?
**A:** Potrzebujesz tabel:
- `businesses` (restauracje)
- `menu_items` (pozycje menu)
- `orders` (zamówienia)

Zobacz schema w plikach testowych (`test-supabase-*.js`)

## Google Maps

### Q: Czy potrzebuję Google Maps API?
**A:** Tylko dla `/api/search` i `/api/places`. Reszta działa bez tego.

### Q: Gdzie wziąć Google Maps API key?
**A:** 
1. [Google Cloud Console](https://console.cloud.google.com)
2. APIs & Services → Credentials
3. Create Credentials → API Key
4. Enable "Places API"

## Migracja

### Q: Mogę rozdzielić mono-API na osobne pliki?
**A:** Tak! Jeśli przejdziesz na Vercel Pro:
1. Skopiuj `api/index.js` → `api/health.js`
2. Usuń wszystko oprócz `handleHealth()`
3. Zmień export na `export default handleHealth`
4. Powtórz dla innych endpointów
5. Usuń `rewrites` z `vercel.json`

### Q: Jak wrócić do Express/Node server?
**A:** `server.js` nadal działa lokalnie:
```bash
npm start
# Serwer na http://localhost:3003
```

Ale na Vercel musisz użyć serverless functions.

## Monitoring

### Q: Jak sprawdzić logi produkcyjne?
**A:** 
1. Vercel Dashboard → Deployments
2. Wybierz deployment
3. Functions → `/api/index`
4. Zobacz real-time logs

Lub CLI: `vercel logs <deployment-url>`

### Q: Jak dodać monitoring?
**A:** Opcje:
- **Vercel Analytics**: `npm i @vercel/analytics`
- **Sentry**: error tracking
- **LogRocket**: session replay
- **Datadog**: full observability

### Q: Jak ustawić alerty?
**A:** Vercel Pro ma wbudowane alerty. Lub użyj:
- Sentry alerts
- UptimeRobot (ping endpoint)
- PagerDuty

## Performance

### Q: Jak zmniejszyć cold start time?
**A:** 
1. Minimalizuj dependencies (usuń nieużywane)
2. Użyj lazy imports dla rzadko używanych modułów
3. Vercel Pro ma lepsze cold starts
4. Rozważ Vercel Edge Functions (beta)

### Q: Ile requestów może obsłużyć?
**A:** Vercel Trial:
- 100GB bandwidth/miesiąc
- 100 GB-hours execution/miesiąc
- Automatic scaling (do limitu)

Pro ma więcej. Zobacz: [Vercel Limits](https://vercel.com/docs/limits)

## Koszty

### Q: Ile to kosztuje?
**A:** 
- **Vercel Trial**: Darmowy (z limitami)
- **Vercel Pro**: $20/miesiąc (więcej functions, bandwidth)
- **Supabase**: Darmowy tier (do 500MB database)
- **Google Maps**: $200 free credit/miesiąc

### Q: Kiedy powinienem upgrade'ować?
**A:** Jeśli:
- Przekraczasz 12 serverless functions
- Potrzebujesz więcej bandwidth
- Chcesz custom domains (>1)
- Potrzebujesz team collaboration
- Chcesz lepsze SLA

## Bezpieczeństwo

### Q: Czy API jest bezpieczne?
**A:** Basic security jest skonfigurowane:
- ✅ CORS headers
- ✅ HTTPS (automatyczne na Vercel)
- ⚠️ Brak authentication (TODO)
- ⚠️ Brak rate limiting (TODO)

Dla production dodaj:
- JWT authentication
- Rate limiting (np. Upstash)
- Input validation
- Supabase RLS policies

### Q: Jak dodać authentication?
**A:** Opcje:
1. **Supabase Auth**: wbudowane JWT
2. **NextAuth**: OAuth providers
3. **Auth0**: enterprise auth
4. **Custom**: własny JWT handler

Zobacz: [Supabase Auth docs](https://supabase.com/docs/guides/auth)

## Inne

### Q: Gdzie zgłosić bug?
**A:** 
- GitHub Issues w repozytorium
- Lub sprawdź logi i ROZWIAZANIE.md

### Q: Jak mogę pomóc w rozwoju?
**A:** 
1. Fork repo
2. Dodaj feature/fix
3. Pull request
4. Opisz zmiany w PR

### Q: Gdzie znaleźć przykłady użycia?
**A:** Zobacz pliki:
- `QUICK_START.md` - przykłady curl
- `tests/api.spec.ts` - testy API
- `scripts/smoke.mjs` - smoke tests
- Frontend: `public/drweb.html`

---

## 📚 Więcej pomocy

Nie znalazłeś odpowiedzi? Zobacz:
- 🚀 [QUICK_START.md](./QUICK_START.md)
- 📋 [DEPLOYMENT.md](./DEPLOYMENT.md)
- 🏗️ [ARCHITECTURE.md](./ARCHITECTURE.md)
- ✅ [ROZWIAZANIE.md](./ROZWIAZANIE.md)

Lub otwórz Issue na GitHub!
