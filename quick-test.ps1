# quick-test.ps1 - Quick live testing script for PowerShell

$BASE_URL = "http://localhost:3000"
$SESSION_ID = "quicktest-$(Get-Date -Format 'yyyyMMddHHmmss')"

Write-Host "🧪 FreeFlow Backend - Quick Live Test" -ForegroundColor Cyan
Write-Host "======================================" -ForegroundColor Cyan
Write-Host ""

function Test-Endpoint {
    param(
        [string]$Name,
        [string]$Method,
        [string]$Endpoint,
        [hashtable]$Body = $null
    )
    
    Write-Host "Testing $Name... " -NoNewline
    
    try {
        $params = @{
            Uri = "$BASE_URL$Endpoint"
            Method = $Method
            ContentType = "application/json"
        }
        
        if ($Body) {
            $params.Body = $Body | ConvertTo-Json -Depth 10
        }
        
        $response = Invoke-RestMethod @params
        
        Write-Host "✅ OK" -ForegroundColor Green
        $response | ConvertTo-Json -Depth 10 | Write-Host
        Write-Host ""
        
    } catch {
        Write-Host "❌ FAIL" -ForegroundColor Red
        Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
        Write-Host ""
    }
}

# 1. Health Check
Test-Endpoint -Name "Health Check" -Method "GET" -Endpoint "/api/health"

# 2. Restaurants List
Test-Endpoint -Name "Restaurants List" -Method "GET" -Endpoint "/api/restaurants"

# 3. Brain API - Find Nearby
Test-Endpoint -Name "Brain: Find Nearby" -Method "POST" -Endpoint "/api/brain" -Body @{
    text = "Gdzie zjeść w Piekarach?"
    sessionId = $SESSION_ID
}

# 4. Brain API - Menu Request
Test-Endpoint -Name "Brain: Menu Request" -Method "POST" -Endpoint "/api/brain" -Body @{
    text = "Pokaż menu Monte Carlo"
    sessionId = $SESSION_ID
}

# 5. Brain API - Create Order
Test-Endpoint -Name "Brain: Create Order" -Method "POST" -Endpoint "/api/brain" -Body @{
    text = "Zamów pizzę Margherita"
    sessionId = $SESSION_ID
}

# 6. Brain Stats
Test-Endpoint -Name "Brain Stats" -Method "GET" -Endpoint "/api/brain/stats?sessionId=$SESSION_ID"

# 7. Orders List
Test-Endpoint -Name "Orders List" -Method "GET" -Endpoint "/api/orders"

Write-Host "======================================" -ForegroundColor Cyan
Write-Host "✅ Quick test completed!" -ForegroundColor Green
Write-Host ""
Write-Host "💡 Tip: For better formatting, pipe results to Format-Table or Format-List" -ForegroundColor Yellow

