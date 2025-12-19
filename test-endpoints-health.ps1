# Test Health of FreeFlow API Endpoints
# PowerShell script to test all major endpoints

Write-Host "🧪 Testing FreeFlow API Endpoints" -ForegroundColor Cyan
Write-Host "=================================" -ForegroundColor Cyan
Write-Host ""

$BASE_URL = "http://localhost:3000"

# Test 1: Health Check
Write-Host "1️⃣  Testing /api/health..." -ForegroundColor Yellow
try {
    $response = Invoke-RestMethod "$BASE_URL/api/health" -Method GET
    Write-Host "✅ Health: OK" -ForegroundColor Green
    Write-Host "   - Service: $($response.service)" -ForegroundColor Gray
    Write-Host "   - Node: $($response.node)" -ForegroundColor Gray
    Write-Host "   - Supabase: $($response.supabase.ok)" -ForegroundColor Gray
} catch {
    Write-Host "❌ Health: FAILED" -ForegroundColor Red
    Write-Host "   Error: $_" -ForegroundColor Red
}
Write-Host ""

# Test 2: Brain API
Write-Host "2️⃣  Testing /api/brain..." -ForegroundColor Yellow
try {
    $body = @{
        text = "Cześć Amber"
        sessionId = "test-health-check"
    } | ConvertTo-Json
    
    $response = Invoke-RestMethod "$BASE_URL/api/brain" -Method POST -Body $body -ContentType "application/json"
    Write-Host "✅ Brain: OK" -ForegroundColor Green
    Write-Host "   - Intent: $($response.intent)" -ForegroundColor Gray
    Write-Host "   - Reply: $($response.reply.Substring(0, [Math]::Min(60, $response.reply.Length)))..." -ForegroundColor Gray
} catch {
    Write-Host "❌ Brain: FAILED" -ForegroundColor Red
    Write-Host "   Error: $_" -ForegroundColor Red
}
Write-Host ""

# Test 3: TTS API
Write-Host "3️⃣  Testing /api/tts..." -ForegroundColor Yellow
try {
    $body = @{
        text = "Cześć"
        tone = "swobodny"
    } | ConvertTo-Json
    
    $response = Invoke-RestMethod "$BASE_URL/api/tts" -Method POST -Body $body -ContentType "application/json" -ErrorAction Stop
    Write-Host "✅ TTS: OK" -ForegroundColor Green
    Write-Host "   - Audio generated successfully" -ForegroundColor Gray
} catch {
    Write-Host "⚠️  TTS: FAILED (może brakować Google credentials)" -ForegroundColor Yellow
    Write-Host "   Error: $($_.Exception.Message)" -ForegroundColor Gray
}
Write-Host ""

# Test 4: Restaurants API
Write-Host "4️⃣  Testing /api/restaurants..." -ForegroundColor Yellow
try {
    $response = Invoke-RestMethod "$BASE_URL/api/restaurants" -Method GET
    Write-Host "✅ Restaurants: OK" -ForegroundColor Green
    Write-Host "   - Found: $($response.data.Count) restaurants" -ForegroundColor Gray
} catch {
    Write-Host "❌ Restaurants: FAILED" -ForegroundColor Red
    Write-Host "   Error: $_" -ForegroundColor Red
}
Write-Host ""

# Test 5: Brain with Restaurant Query
Write-Host "5️⃣  Testing Brain with restaurant query..." -ForegroundColor Yellow
try {
    $body = @{
        text = "Gdzie mogę zjeść w Bytomiu?"
        sessionId = "test-health-check-2"
    } | ConvertTo-Json
    
    $response = Invoke-RestMethod "$BASE_URL/api/brain" -Method POST -Body $body -ContentType "application/json"
    Write-Host "✅ Brain Restaurant Query: OK" -ForegroundColor Green
    Write-Host "   - Intent: $($response.intent)" -ForegroundColor Gray
    Write-Host "   - Confidence: $($response.confidence)" -ForegroundColor Gray
    if ($response.context.last_location) {
        Write-Host "   - Location detected: $($response.context.last_location)" -ForegroundColor Gray
    }
} catch {
    Write-Host "❌ Brain Restaurant Query: FAILED" -ForegroundColor Red
    Write-Host "   Error: $_" -ForegroundColor Red
}
Write-Host ""

# Summary
Write-Host "=================================" -ForegroundColor Cyan
Write-Host "🎉 Health check completed!" -ForegroundColor Cyan
Write-Host ""
Write-Host "📊 Quick Test Commands:" -ForegroundColor Yellow
Write-Host "  - Test Brain:       Invoke-RestMethod http://localhost:3000/api/brain -Method POST -Body (@{text='Cześć'} | ConvertTo-Json) -ContentType 'application/json'" -ForegroundColor Gray
Write-Host "  - Test TTS:         Invoke-RestMethod http://localhost:3000/api/tts -Method POST -Body (@{text='Cześć'} | ConvertTo-Json) -ContentType 'application/json'" -ForegroundColor Gray
Write-Host "  - Test Health:      Invoke-RestMethod http://localhost:3000/api/health" -ForegroundColor Gray
Write-Host ""

