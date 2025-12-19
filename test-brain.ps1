# ==============================
# ✅ AMBER BRAIN HTTP TEST v1.2
# ==============================

# Adres API (lokalny lub Vercel)
$apiUrl = "http://localhost:3000/api/brain"

# Tekst do przetworzenia
$text = "Gdzie zjem w pobliżu?"

# Czas startu
$start = Get-Date

Write-Host "🧠 Test Amber Brain API" -ForegroundColor Cyan
Write-Host "🌐 Endpoint: $apiUrl"
Write-Host "💬 Zapytanie: $text"
Write-Host "-----------------------------------"

try {
    # Wysyłka zapytania JSON
    $body = @{
        sessionId = "amber_test"
        text = $text
    } | ConvertTo-Json

    $headers = @{ "Content-Type" = "application/json" }

    # Wykonanie żądania
    $response = Invoke-RestMethod -Uri $apiUrl -Method POST -Headers $headers -Body $body

    # Czas trwania
    $duration = (Get-Date) - $start

    Write-Host "`n✅ Odpowiedź otrzymano po $([math]::Round($duration.TotalMilliseconds)) ms" -ForegroundColor Green
    Write-Host "-----------------------------------"

    # Formatowanie wyniku
    Write-Host "🔹 Status:`t" $response.ok
    Write-Host "🔹 Odpowiedź:`t" $response.reply
    Write-Host "🔹 Intent:`t" $response.intent
    Write-Host "🔹 Timestamp:`t" $response.timestamp
}
catch {
    Write-Host "`n❌ Błąd podczas komunikacji:" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor DarkRed
}
