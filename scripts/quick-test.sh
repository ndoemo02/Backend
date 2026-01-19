#!/bin/bash
# quick-test.sh - Quick live testing script

BASE_URL="http://localhost:3000"
SESSION_ID="quicktest-$(date +%s)"

echo "🧪 FreeFlow Backend - Quick Live Test"
echo "======================================"
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test function
test_endpoint() {
    local name=$1
    local method=$2
    local endpoint=$3
    local data=$4
    
    echo -n "Testing $name... "
    
    if [ "$method" = "GET" ]; then
        response=$(curl -s -w "\n%{http_code}" "$BASE_URL$endpoint")
    else
        response=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL$endpoint" \
            -H "Content-Type: application/json" \
            -d "$data")
    fi
    
    http_code=$(echo "$response" | tail -n1)
    body=$(echo "$response" | sed '$d')
    
    if [ "$http_code" -ge 200 ] && [ "$http_code" -lt 300 ]; then
        echo -e "${GREEN}✅ OK${NC} (HTTP $http_code)"
        if command -v jq &> /dev/null; then
            echo "$body" | jq -C '.' 2>/dev/null || echo "$body"
        else
            echo "$body"
        fi
    else
        echo -e "${RED}❌ FAIL${NC} (HTTP $http_code)"
        echo "$body"
    fi
    echo ""
}

# 1. Health Check
test_endpoint "Health Check" "GET" "/api/health"

# 2. Restaurants List
test_endpoint "Restaurants List" "GET" "/api/restaurants"

# 3. Brain API - Find Nearby
test_endpoint "Brain: Find Nearby" "POST" "/api/brain" \
    "{\"text\": \"Gdzie zjeść w Piekarach?\", \"sessionId\": \"$SESSION_ID\"}"

# 4. Brain API - Menu Request
test_endpoint "Brain: Menu Request" "POST" "/api/brain" \
    "{\"text\": \"Pokaż menu Monte Carlo\", \"sessionId\": \"$SESSION_ID\"}"

# 5. Brain API - Create Order
test_endpoint "Brain: Create Order" "POST" "/api/brain" \
    "{\"text\": \"Zamów pizzę Margherita\", \"sessionId\": \"$SESSION_ID\"}"

# 6. Brain Stats
test_endpoint "Brain Stats" "GET" "/api/brain/stats?sessionId=$SESSION_ID"

# 7. Orders List
test_endpoint "Orders List" "GET" "/api/orders"

echo "======================================"
echo -e "${GREEN}✅ Quick test completed!${NC}"
echo ""
echo "💡 Tip: Install 'jq' for better JSON formatting:"
echo "   Ubuntu/Debian: sudo apt-get install jq"
echo "   Mac: brew install jq"

