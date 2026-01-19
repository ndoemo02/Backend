# ==============================
# ✅ AMBER WEBSOCKET TEST v2.0
# ==============================
$uri = "ws://localhost:3000/api/live"
$ws = [System.Net.WebSockets.ClientWebSocket]::new()
$cts = [System.Threading.CancellationTokenSource]::new()

try {
    # Połączenie
    Write-Host "🔗 Łączenie z $uri..."
    $ws.ConnectAsync([Uri]$uri, $cts.Token).Wait()
    Write-Host "✅ Połączono z serwerem!"

    # Wiadomość testowa
    $msg = '{"sessionId":"amber_test","text":"Zamów mi pizzę Capricciosa"}'
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($msg)
    $sendBuffer = [System.ArraySegment[byte]]::new($bytes)
    $ws.SendAsync($sendBuffer, [System.Net.WebSockets.WebSocketMessageType]::Text, $true, $cts.Token).Wait()
    Write-Host "📤 Wysłano: $msg"

    # Odbiór
    $recvBytes = New-Object byte[] 4096
    $recvBuffer = [System.ArraySegment[byte]]::new($recvBytes)
    $result = $ws.ReceiveAsync($recvBuffer, $cts.Token).Result
    $response = [System.Text.Encoding]::UTF8.GetString($recvBuffer.Array, 0, $result.Count)

    Write-Host "`n🧠 Odpowiedź Amber:"
    Write-Host $response

} catch {
    Write-Host "❌ Błąd: $($_.Exception.Message)"
}
finally {
    if ($ws -and $ws.State -eq [System.Net.WebSockets.WebSocketState]::Open) {
        $ws.CloseAsync([System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure, "done", $cts.Token).Wait()
    }
    Write-Host "`n✅ Zamknięto połączenie WebSocket."
}
